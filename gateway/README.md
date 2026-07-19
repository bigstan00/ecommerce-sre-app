# API Gateway

The public entry point for the e-commerce practice app. A reverse proxy (Fastify +
`@fastify/http-proxy`) that routes `/api/*` requests to the Auth, Catalog, Cart, and
Order services, and is the only service in the system that verifies JWTs.

See `/Users/dakwojistanley/ecommerce-sre-app/shared/CONTRACTS.md` for the full
cross-service contract this implementation follows.

## Trust boundary

The gateway is the **only** public entry point. It verifies the caller's JWT on
`/api/cart/*` and `/api/orders/*` and forwards their identity downstream via an
`X-User-Id` header. **Auth, Catalog, Cart, and Order trust that header and do not
re-verify the JWT themselves.** This is realistic microservice practice, but it means those services
are only safe if network policy prevents anything except the gateway from reaching
them directly.

**`JWT_SECRET` must be the exact same value used by the Auth service** — the
gateway verifies tokens the Auth service signs, using a shared HS256 secret. If
the two services disagree on this value, every cart request will fail with 401
even for a freshly issued, valid-looking token.

TODO (Phase 3 / later): enforce this trust boundary with real network policy
(e.g. Kubernetes `NetworkPolicy`) so Auth/Catalog/Cart are unreachable except
from the gateway. Not implemented here — out of scope for Phase 1.

## Routing table

| Path prefix | Upstream | Auth required | Notes |
|---|---|---|---|
| `/api/auth/*` | `AUTH_SERVICE_URL` | No | Strips `/api`; these are the auth endpoints themselves. `GET /api/auth/me` passes the caller's own bearer token straight through, unmodified. |
| `/api/products/*` | `CATALOG_SERVICE_URL` | No | Public browsing. Strips `/api`. |
| `/api/categories/*` | `CATALOG_SERVICE_URL` | No | Public browsing. Strips `/api`. |
| `/api/cart/*` | `CART_SERVICE_URL` | **Yes** | Requires `Authorization: Bearer <token>`, verified with `JWT_SECRET` (HS256). On success, injects `X-User-Id: <sub claim>` into the forwarded request. Returns `401` on missing, malformed, invalid, or expired tokens. |
| `/api/orders/*` | `ORDER_SERVICE_URL` | **Yes** | Same auth treatment as `/api/cart/*`: requires `Authorization: Bearer <token>`, verified with `JWT_SECRET` (HS256). On success, injects `X-User-Id: <sub claim>` into the forwarded request. Returns `401` on missing, malformed, invalid, or expired tokens. Added in Phase 2. |
| `/api/admin/products/*` | `CATALOG_SERVICE_URL` | No (passthrough) | Strips `/api/admin`, forwards to `/products*`. No JWT — the gateway does not verify `X-Admin-Token`, it passes the header through untouched and Catalog validates it. Added in Phase 5. |
| `/api/admin/inventory/*` | `INVENTORY_SERVICE_URL` | No (passthrough) | Strips `/api/admin`, forwards to `/inventory*`. No JWT — same `X-Admin-Token` passthrough as above; Inventory validates it. Inventory was Kafka-only before Phase 5 and was never proxied by the gateway until now. Added in Phase 5. |
| `/api/admin/orders/*` | `ORDER_SERVICE_URL` | No (passthrough) | Strips only `/api` (keeps the `/admin` segment), forwards to `/admin/orders*`. No JWT — same `X-Admin-Token` passthrough as above; Order validates it. Distinct from `/api/orders/*`, which is JWT-scoped to the caller. Added in Phase 5. |
| `GET /healthz` | — | No | Liveness. Always `200 {"status":"ok"}`. |
| `GET /readyz` | — | No | Readiness. Pings each upstream's own `/healthz` (auth, catalog, cart, order); `200 {"status":"ready"}` if all respond, else `503 {"status":"not-ready","reason":"..."}`. |
| `GET /metrics` | — | No | Prometheus exposition format: request count, request duration histogram, error count — labeled by `method`, `upstream` (`auth`/`catalog`/`cart`/`order`/`gateway`), `route`, `status_code`. |

## Env vars

All configuration is via environment variables — see `.env.example` for the full
list with safe dummy defaults:

| Var | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | No | `8080` | Port the gateway listens on. |
| `AUTH_SERVICE_URL` | Yes | — | Base URL of the Auth service, e.g. `http://localhost:4001`. |
| `CATALOG_SERVICE_URL` | Yes | — | Base URL of the Catalog service, e.g. `http://localhost:4002`. Also backs `/api/admin/products/*`. |
| `CART_SERVICE_URL` | Yes | — | Base URL of the Cart service, e.g. `http://localhost:4003`. |
| `ORDER_SERVICE_URL` | Yes | — | Base URL of the Order service, e.g. `http://localhost:4004`. Also backs `/api/admin/orders/*`. |
| `INVENTORY_SERVICE_URL` | No | `http://localhost:4006` | Base URL of the Inventory service, used by `/api/admin/inventory/*`. Inventory was Kafka-only before Phase 5 and was never called synchronously by the gateway before this. |
| `JWT_SECRET` | Yes | — | Shared HS256 secret used to verify JWTs on `/api/cart/*` and `/api/orders/*`. **Must match the Auth service's `JWT_SECRET`.** |
| `LOG_LEVEL` | No | `info` | pino log level (`trace`\|`debug`\|`info`\|`warn`\|`error`\|`fatal`). |
| `READINESS_TIMEOUT_MS` | No | `2000` | Per-upstream timeout (ms) used by `/readyz` when checking upstream health. |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | No | `300` / `1 minute` | General rate limit applied to every route except `/healthz`, `/readyz`, `/metrics`. |
| `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_AUTH_WINDOW` | No | `10` / `1 minute` | Stricter limit applied only to `/api/auth/*`, since login/register are brute-force targets. Stacks on top of the general limit, not instead of it. |
| `RATE_LIMIT_USER_MAX` / `RATE_LIMIT_USER_WINDOW` | No | `60` / `1 minute` | Third limit applied only to `/api/cart/*` and `/api/orders/*`, keyed by user ID instead of IP. **Must be lower than `RATE_LIMIT_MAX`** — the gateway refuses to start otherwise. |
| `RATE_LIMIT_REDIS_URL` | No | unset (in-memory) | Set this once you run more than one gateway replica — see "Rate limiting" below. |

The gateway fails fast on startup (logs a fatal error and exits 1) if any
required env var is missing, or if `RATE_LIMIT_USER_MAX >= RATE_LIMIT_MAX`
(see `assertRateLimitInvariants` in `config.ts`).

## Rate limiting

Three independent rate limiters, all from `@fastify/rate-limit`:

- **Global** — applies to every route in the app except `/healthz`, `/readyz`, `/metrics`
  (those three opt out individually via `config: { rateLimit: false }` in `routes/health.ts`
  — `allowList` on the plugin filters by client key/IP, not by URL, so it can't be used to
  exempt a route by path). Keyed by client IP (the library's default).
- **Auth-specific** — a second, stricter limiter scoped only to `/api/auth/*` via a nested
  Fastify plugin context. Also keyed by IP, since there's no logged-in identity yet on these
  routes. Both this and the global limiter run on every auth request — general first, then
  auth-specific — so an auth request has to pass both, and the auth counter's budget is
  separate from (not carved out of) the general one.
- **Per-user** — a third limiter scoped to `/api/cart/*` and `/api/orders/*`, keyed by the
  caller's user ID rather than IP, so people behind a shared/office IP each get their own
  budget instead of splitting one. This one runs at the `preHandler` lifecycle stage instead
  of the default `onRequest`, specifically so it executes *after* each route's own JWT check
  has already run and set `request.userId` — an unauthenticated request gets rejected by the
  JWT check first and never reaches this limiter at all. **This limiter's max must stay lower
  than the global limiter's max**: otherwise a single user could exhaust the entire shared IP
  budget before their own per-user cap ever engages, which defeats the reason it exists. The
  gateway enforces this at startup and refuses to boot if it's violated.

A 429 response body matches the gateway's existing error convention:
`{"error":"TooManyRequests","message":"Rate limit exceeded, retry in <window>"}`.
Every rejection increments `gateway_rate_limit_exceeded_total{upstream,limiter}` (`limiter`
is `global`/`auth`/`user`) and logs a `warn`-level line with the client IP and which limiter
fired.

**Multiple replicas**: by default each rate limiter counts in this process's own memory.
That's correct for one gateway instance, but wrong the moment you run several replicas
behind a load balancer — each replica counts independently, so the effective limit becomes
`configured_max × replica_count`. Set `RATE_LIMIT_REDIS_URL` to point every replica at the
same Redis instance and they'll share one counter instead. All three limiters use distinct
Redis key namespaces (`gw-rl-global:` / `gw-rl-auth:` / `gw-rl-user:`) so they don't collide
with each other.

## Run locally

```bash
cd gateway
cp .env.example .env   # edit values — at minimum point *_SERVICE_URL at running
                        # instances of auth/catalog/cart/order, and set JWT_SECRET
                        # to match the Auth service

npm install
npm run build
npm start               # runs the compiled dist/index.js
```

For iterative development with auto-reload:

```bash
npm run dev              # tsx watch src/index.ts
```

Other scripts:

```bash
npm run typecheck        # tsc --noEmit, no build output
```

## Run with Docker

```bash
docker build -t gateway .
docker run --rm -p 8080:8080 \
  -e AUTH_SERVICE_URL=http://host.docker.internal:4001 \
  -e CATALOG_SERVICE_URL=http://host.docker.internal:4002 \
  -e CART_SERVICE_URL=http://host.docker.internal:4003 \
  -e ORDER_SERVICE_URL=http://host.docker.internal:4004 \
  -e JWT_SECRET=dev-shared-secret-change-me \
  gateway
```

The image is a multi-stage build (`node:22-alpine`) that compiles TypeScript in a
builder stage, then copies only the compiled `dist/`, pruned production
`node_modules`, and `package.json` into a minimal runtime stage. The process runs
as a non-root user (`gateway`), and a `HEALTHCHECK` hits `/healthz` on the
configured `PORT`.

## Logging

Structured JSON logs to stdout, one object per line (pino), with `timestamp`,
`level`, `service` (`"gateway"`), `message`, plus request-scoped context fields
(`reqId`, `req`, `res`, etc.) added automatically by Fastify's request logging.
No `console.log`/`console.error` is used for application logs.

## Metrics

`GET /metrics` exposes Prometheus text format, including:

- `gateway_http_requests_total{method,upstream,route,status_code}` — request counter.
- `gateway_http_request_duration_seconds{method,upstream,route,status_code}` — duration histogram.
- `gateway_http_request_errors_total{method,upstream,route,status_code}` — counts responses with status >= 500 and gateway-level proxy failures.
- Default Node.js process metrics (`gateway_process_*`, `gateway_nodejs_*`) via `prom-client`'s `collectDefaultMetrics`.

Requests are labeled by logical `upstream` (`auth`, `catalog`, `cart`, `order`, or
`gateway` for the gateway's own health/metrics endpoints) rather than raw URL,
to avoid unbounded cardinality from path parameters like
`/api/cart/items/:productId`.

## Tracing

Phase 4 adds OpenTelemetry distributed tracing so a request can be followed
across services. `src/tracing.ts` is imported as the very first line of
`src/index.ts` (before `./app`, `./config`, fastify, `@fastify/http-proxy`,
`ioredis`, etc.) and initializes `@opentelemetry/sdk-node` with
`@opentelemetry/auto-instrumentations-node`, exporting via OTLP over HTTP
(`@opentelemetry/exporter-trace-otlp-http`). That ordering matters:
auto-instrumentation patches modules at `require()` time, so it has to run
before anything else requires them.

- **Instrumented automatically, no manual span code**: the HTTP server
  (every route, including `/healthz`, `/readyz`, `/metrics`), and HTTP
  client calls — which is what makes this useful here specifically, since
  `@fastify/http-proxy`'s proxying of `/api/*` to Auth/Catalog/Cart/Order is
  built on Node's `http`/`https` modules under the hood and gets picked up
  by the same instrumentation. The `ioredis` client used for shared
  rate-limit counters (`RATE_LIMIT_REDIS_URL`) is instrumented too.
- **Propagation**: W3C Trace Context (the OTel SDK's default propagator) —
  the gateway is the first hop for most requests, so it's usually the
  service that *starts* a trace; the `traceparent` header it emits on each
  proxied request is what lets Auth/Catalog/Cart/Order continue that same
  trace instead of starting their own.
- **Config**: `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4318`)
  and `OTEL_SERVICE_NAME` (default `gateway`) — both standard OTel env vars
  read automatically by the SDK, see `.env.example`. If the endpoint is
  unreachable, spans are dropped and a warning is logged; tracing never
  blocks startup or requests.
- **Sampling: always-on (100%)**. This is a deliberate simplification for
  this practice app's low traffic — a production deployment would sample
  well below 100% to control span volume/cost.
