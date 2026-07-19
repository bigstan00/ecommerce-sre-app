# Cart Service

Cart microservice for the e-commerce SRE practice app. Node.js + TypeScript, Fastify,
Redis for storage, and an HTTP client call to the Catalog service to validate products
and snapshot prices.

## Trust boundary

This service trusts the `X-User-Id` header on every request and does **not** verify a
JWT itself. Per `shared/CONTRACTS.md`, the API gateway is the only public entry point:
it verifies the caller's JWT and injects `X-User-Id` before proxying here. That means
this service is only safe to run if network policy prevents anything except the gateway
from reaching it directly. In a real deployment this should be enforced with a
Kubernetes `NetworkPolicy` restricting ingress to the gateway's pods — that's a TODO for
later k8s practice, not implemented in this Phase 1 code.

## Running locally

Prerequisites:

- Node.js 20+
- A running Redis instance reachable at `REDIS_URL`
- A running Catalog service reachable at `CATALOG_SERVICE_URL` (needed for `POST` and
  `PUT` on cart items, since the cart validates products and snapshots prices via
  `GET /products/:id` on Catalog)

Steps:

```bash
cp .env.example .env
# edit .env if your Redis / Catalog URLs differ from the defaults

npm install
npm run build
npm start
```

For local development with auto-reload:

```bash
npm install
npm run dev
```

The service listens on `PORT` (default `4003`).

## Environment variables

| Var | Required | Default | Description |
|---|---|---|---|
| `PORT` | no | `4003` | HTTP port the server listens on |
| `REDIS_URL` | no | `redis://localhost:6379` | Redis connection string used to store carts |
| `CATALOG_SERVICE_URL` | no | `http://localhost:4002` | Base URL of the Catalog service |
| `LOG_LEVEL` | no | `info` | pino log level (`trace`\|`debug`\|`info`\|`warn`\|`error`\|`fatal`) |

See `.env.example` for a ready-to-copy template.

## Data model

Carts are stored in Redis under key `cart:{userId}` as JSON:

```json
{ "items": [{ "productId": "...", "quantity": 1, "priceSnapshot": 19.99 }], "updatedAt": "..." }
```

The key has a 7-day TTL, refreshed on every write.

## Endpoints

All `/cart*` endpoints require an `X-User-Id` header (set by the gateway). Requests
without it get `401`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/cart` | — | `200 {items, total}` |
| POST | `/cart/items` | `{productId, quantity}` | `200 {cart}` / `404` if product doesn't exist / `502` if Catalog is unreachable |
| PUT | `/cart/items/:productId` | `{quantity}` | `200 {cart}` — `quantity <= 0` removes the item |
| DELETE | `/cart/items/:productId` | — | `200 {cart}` |
| DELETE | `/cart` | — | `204` |

Operational endpoints (no `X-User-Id` required):

| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | Liveness — `200 {status:"ok"}`, no dependency checks |
| GET | `/readyz` | Readiness — pings Redis; `200 {status:"ready"}` or `503 {status:"not-ready", reason}` |
| GET | `/metrics` | Prometheus exposition format: request count, request duration histogram, error count, plus default Node process metrics |

## Error handling

- Missing `X-User-Id` → `401`.
- Adding/updating an item for a product Catalog doesn't recognize → `404`.
- Catalog unreachable or returning an unexpected error → `502` (never crashes the
  process; logged as a structured error).
- Redis unreachable → `503` on cart read/write endpoints.

## Logging

Structured JSON logs to stdout via pino — one JSON object per line with `timestamp`,
`level`, `service`, `message`, plus request/context fields. No `console.log`.

## Tracing

Phase 4 adds OpenTelemetry distributed tracing so a request can be followed
across services. `src/tracing.ts` is imported as the very first line of
`src/index.ts` (before `./server`, `./lib/redisClient`, fastify, `redis`,
etc.) and initializes `@opentelemetry/sdk-node` with
`@opentelemetry/auto-instrumentations-node`, exporting via OTLP over HTTP
(`@opentelemetry/exporter-trace-otlp-http`). That ordering matters:
auto-instrumentation patches modules at `require()` time, so it has to run
before anything else requires them.

- **Instrumented automatically, no manual span code**: the HTTP server
  (every `/cart*`, `/healthz`, `/readyz`, `/metrics` request), the HTTP
  client used to call the Catalog service (`CATALOG_SERVICE_URL`), and the
  Redis client (`redis` v4) used by `src/lib/redisClient.ts`.
- **Propagation**: W3C Trace Context (the OTel SDK's default propagator) —
  when the gateway forwards a request here with a `traceparent` header,
  this service's spans automatically continue that same trace, and the
  outgoing call to Catalog carries it forward in turn.
- **Config**: `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4318`)
  and `OTEL_SERVICE_NAME` (default `cart-service`) — both standard OTel env
  vars read automatically by the SDK, see `.env.example`. If the endpoint is
  unreachable, spans are dropped and a warning is logged; tracing never
  blocks startup or requests.
- **Sampling: always-on (100%)**. This is a deliberate simplification for
  this practice app's low traffic — a production deployment would sample
  well below 100% to control span volume/cost.

## Docker

```bash
docker build -t cart-service .
docker run --rm -p 4003:4003 \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e CATALOG_SERVICE_URL=http://host.docker.internal:4002 \
  cart-service
```

Multi-stage build, runs as a non-root user, minimal Alpine-based final image.
