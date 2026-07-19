# Service Contracts

This is the single source of truth for how services talk to each other.
Every service must conform to this exactly — do not improvise field names, ports, topics, or paths.
Phase 1 (Auth, Catalog, Cart, Gateway, Storefront) is built and running. Phase 2 (Order,
Inventory, Payment, Notification, plus Kafka) is specified below the Phase 1 section.

## Cross-cutting conventions (every service, no exceptions)

- `GET /healthz` → `200 {"status":"ok"}` — liveness, no dependency checks.
- `GET /readyz` → `200 {"status":"ready"}` or `503 {"status":"not-ready","reason":"..."}` — must actually check DB/Redis/Mongo connectivity.
- `GET /metrics` → Prometheus exposition format (request count, request duration histogram, error count at minimum).
- All config via environment variables only. Ship a `.env.example` listing every var the service reads, with safe dummy defaults. No hardcoded connection strings, ports, or secrets.
- Structured JSON logs to stdout (one JSON object per line: `timestamp`, `level`, `service`, `message`, plus context fields). Node → pino. Go → zap. No `console.log`/`fmt.Println` for app logs.
- Port comes from `PORT` env var; document the default in `.env.example`.
- Provide a multi-stage `Dockerfile` in the service root, non-root user, minimal final image.
- Provide a `README.md` in the service root: how to run locally, env vars, and endpoint list.
- Do NOT write `docker-compose.yml`, Kubernetes manifests, or CI config anywhere in this repo — that's out of scope, the human is doing that by hand.
- Do NOT run `git commit` — just write files. Commits happen once at the end after review.

## Ports (local/Compose defaults)

| Service | Port | Env var other services use to reach it |
|---|---|---|
| storefront (frontend) | 3000 | `NEXT_PUBLIC_API_URL` (points at gateway) |
| gateway | 8080 | `GATEWAY_URL` |
| auth | 4001 | `AUTH_SERVICE_URL` |
| catalog | 4002 | `CATALOG_SERVICE_URL` |
| cart | 4003 | `CART_SERVICE_URL` |
| order | 4004 | `ORDER_SERVICE_URL` |
| payment | 4005 | (not called by any other service — Kafka only) |
| inventory | 4006 | (not called by any other service — Kafka only) |
| notification | 4007 | (not called by any other service — Kafka only) |

## Trust boundary (important — document this in each README)

The gateway is the only public entry point. It verifies the JWT and forwards the caller's
identity to downstream services via an `X-User-Id` header. Auth/Catalog/Cart services trust
that header and do NOT re-verify the JWT themselves. This is realistic microservice
practice — but it means these services are only safe if network policy prevents anything
except the gateway from reaching them directly. Note this explicitly as a TODO for k8s
NetworkPolicy practice later. Don't try to "fix" it by adding JWT verification everywhere.

JWT signing: HS256, shared secret via `JWT_SECRET` env var (same value across auth and gateway).

## Auth Service (port 4001, Node.js + TypeScript, PostgreSQL)

Table `users`: `id UUID PK`, `email TEXT UNIQUE`, `password_hash TEXT`, `name TEXT`, `created_at TIMESTAMPTZ`.

- `POST /auth/register` — body `{email, password, name}` → `201 {userId}`. 409 if email taken.
- `POST /auth/login` — body `{email, password}` → `200 {accessToken, refreshToken, expiresIn}`. 401 on bad creds.
- `POST /auth/refresh` — body `{refreshToken}` → `200 {accessToken}`.
- `GET /auth/me` — header `Authorization: Bearer <accessToken>` → `200 {userId, email, name}`.
- `POST /auth/logout` — header `Authorization: Bearer <accessToken>` → `204`.

Passwords hashed with bcrypt (cost 12). Access token TTL 15m, refresh token TTL 7d.
Env vars: `PORT`, `DATABASE_URL`, `JWT_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`.

## Catalog Service (port 4002, Go, MongoDB)

Collection `products`: `_id`, `name`, `description`, `price` (number, dollars), `category`,
`imageUrl`, `stock` (int — placeholder until a real Inventory service exists in Phase 2),
`createdAt`.

- `GET /products?category=&page=&limit=` → `200 {items: [...], total, page, limit}`.
- `GET /products/:id` → `200 {product}` or `404`.
- `GET /categories` → `200 {categories: [string]}`.
- `POST /products` — header `X-Admin-Token: <token>` must equal `ADMIN_TOKEN` env var, else `403`. Body is a product → `201 {id}`. This is a simple static-token admin gate, not full auth — good enough for seeding data in Phase 1.

Include a seed script (`seed.go` or `cmd/seed`) that inserts ~15 sample products across 3-4 categories, runnable via `go run ./cmd/seed`.

Env vars: `PORT`, `MONGO_URI`, `MONGO_DB_NAME`, `ADMIN_TOKEN`.

## Cart Service (port 4003, Node.js + TypeScript, Redis)

Redis key `cart:{userId}` → JSON `{items: [{productId, quantity, priceSnapshot}], updatedAt}`, TTL 7 days, refreshed on every write.

All endpoints require header `X-User-Id` (set by gateway) — `401` if missing.

- `GET /cart` → `200 {items: [...], total}`.
- `POST /cart/items` — body `{productId, quantity}` → `200 {cart}`. Must call Catalog (`CATALOG_SERVICE_URL`) to validate the product exists and to snapshot its current price. `404` if product doesn't exist.
- `PUT /cart/items/:productId` — body `{quantity}` → `200 {cart}`. `quantity <= 0` removes the item.
- `DELETE /cart/items/:productId` → `200 {cart}`.
- `DELETE /cart` → `204`.

Env vars: `PORT`, `REDIS_URL`, `CATALOG_SERVICE_URL`.

## API Gateway (port 8080, Node.js + TypeScript)

Reverse proxy + auth verification, nothing else in Phase 1. (Rate limiting was added in
Phase 3 — see `gateway/README.md`'s "Rate limiting" section; not repeated here since
CONTRACTS.md's job is the request/response contract, not implementation detail.)

- `/api/auth/*` → strips `/api` prefix, proxies to `AUTH_SERVICE_URL`. No JWT check (these are the auth endpoints themselves) — except `GET /api/auth/me` which is a passthrough with the client's own bearer token, no header injection needed there.
- `/api/products/*`, `/api/categories/*` → proxies to `CATALOG_SERVICE_URL`. No JWT required (public browsing).
- `/api/cart/*` → requires valid `Authorization: Bearer <token>` (verify JWT with `JWT_SECRET`), on success inject `X-User-Id: <sub claim>` header and proxy to `CART_SERVICE_URL`. `401` if token missing/invalid/expired.
- `/api/orders/*` → same auth treatment as `/api/cart/*` (JWT required, inject `X-User-Id`), proxies to `ORDER_SERVICE_URL`. Added in Phase 2.
- `GET /healthz`, `GET /readyz`, `GET /metrics` for the gateway itself. `/readyz` should now also check `ORDER_SERVICE_URL`'s `/healthz` alongside the existing upstreams.

Env vars: `PORT`, `AUTH_SERVICE_URL`, `CATALOG_SERVICE_URL`, `CART_SERVICE_URL`, `ORDER_SERVICE_URL`, `JWT_SECRET`.

**Phase 2 change note**: only add the `/api/orders/*` block, the `ORDER_SERVICE_URL` env var, and extend `/readyz`. Do not touch the existing auth/catalog/cart routing — it already works, leave it alone.

## Storefront Frontend (port 3000, Next.js 14+ App Router, TypeScript, Tailwind CSS)

Talks ONLY to the gateway, via `NEXT_PUBLIC_API_URL` (default `http://localhost:8080/api`).

Pages:
- `/` — product listing (grid, category filter, pagination) from `GET /api/products`.
- `/products/[id]` — product detail from `GET /api/products/:id`, "Add to cart" button.
- `/cart` — view/edit cart via `/api/cart` endpoints.
- `/login`, `/register` — forms posting to `/api/auth/login` and `/api/auth/register`.
- `/checkout` — Phase 1 shipped this as a stub. **Phase 2 change**: wire the "Place order" button to `POST /api/orders` (empty body — the Order service reads the caller's cart itself). On success (`201 {orderId, status}`), redirect to `/orders/[id]`.
- `/orders/[id]` — **new in Phase 2**. Shows order status and line items from `GET /api/orders/:id`. Poll every 2s (`setInterval`, cleared on unmount) while status is `pending` or `inventory_reserved`; stop polling once status is `confirmed` or `cancelled`. This is the page where the checkout saga's eventual consistency becomes visible — status should visibly flip as Kafka events land.
- `/orders` — **new in Phase 2**, optional but cheap to add: simple order history list from `GET /api/orders`, linking to each `/orders/[id]`.

Auth token handling: on login/register success, store the access token in an httpOnly cookie
set by a Next.js Route Handler (`/app/api/session/route.ts`) that proxies to the gateway —
do NOT store tokens in localStorage. Read the cookie server-side in Server Components /
Route Handlers to attach `Authorization: Bearer` when calling the gateway for cart and order requests.

Env vars: `NEXT_PUBLIC_API_URL`.

**Phase 2 change note**: only touch `/checkout` (enable the button) and add `/orders/[id]` (and
optionally `/orders`). Do not modify `/`, `/products/[id]`, `/cart`, `/login`, `/register`, or
`lib/api.ts`'s existing exports — only add new functions to `lib/api.ts` for orders. Follow the
existing patterns in the codebase (same error/loading/empty state handling, same API client style,
same httpOnly-cookie auth approach) rather than introducing a new convention.

---

# Phase 2: checkout saga (Order, Inventory, Payment, Notification, Kafka)

Phase 2 wires a real distributed transaction: placing an order kicks off an async saga
across three services, coordinated only through Kafka events — no service calls another
synchronously except where explicitly noted below. Expect eventual consistency: after
`POST /orders` returns, the order is `pending`, not yet confirmed. This is deliberate —
it's the point of the exercise.

## Kafka conventions (every producer/consumer, no exceptions)

- Broker address(es) via `KAFKA_BROKERS` env var (comma-separated, e.g. `localhost:9092`).
- **Every event on every topic uses this envelope, no exceptions:**
  ```json
  {
    "eventId": "uuid-v4",
    "eventType": "order.created",
    "orderId": "uuid-v4",
    "occurredAt": "2026-07-11T10:00:00.000Z",
    "data": { }
  }
  ```
- Partition key = `orderId` (bytes of the UUID string) — guarantees all events for one order
  are processed in order by one consumer instance.
- **Each service creates the topics it produces to** on startup, idempotently, via the Kafka
  admin client (`NewTopic` if not exists) — don't rely on broker auto-create being enabled,
  and don't write a separate topic-init script. If topic creation fails because the broker
  isn't up yet, retry with backoff rather than crashing.
- **Consumers must be idempotent.** Kafka is at-least-once — the same event can arrive twice.
  Don't blindly re-apply a state change. Guard every consumer handler with a check against
  current state (e.g. Order service's `payment.completed` handler should only transition an
  order from `inventory_reserved` → `confirmed`; if it's already `confirmed`, log and no-op
  rather than re-publishing `order.confirmed`).
- Consumer group id = `<service-name>-service` (e.g. `inventory-service`, `payment-service`).
- Log every event produced and consumed at `info` level with `eventId`, `eventType`, `orderId`
  as structured fields — this saga is the thing you'll want to trace end-to-end later.
- Go services: `github.com/segmentio/kafka-go`. Python services: `aiokafka`.

## Topics and who owns them

| Topic | Producer | Consumers | `data` payload |
|---|---|---|---|
| `order.created` | Order | Inventory | `{userId, items: [{productId, quantity, priceSnapshot}], totalAmount}` |
| `inventory.reserved` | Inventory | Payment, Order | `{items: [{productId, quantity}]}` |
| `inventory.failed` | Inventory | Order | `{reason}` |
| `payment.completed` | Payment | Order | `{paymentId, amount}` |
| `payment.failed` | Payment | Order, Inventory | `{reason, amount}` |
| `order.confirmed` | Order | Notification | `{totalAmount}` |
| `order.cancelled` | Order | Notification | `{reason}` |

## The saga, end to end

```
POST /orders (Order service)
  → validates cart is non-empty (calls Cart service GET /cart)
  → creates order row, status=pending
  → publishes order.created
  → clears the cart (calls Cart service DELETE /cart)
  → returns 201 {orderId, status: "pending"} immediately — does NOT wait for the saga

Inventory consumes order.created
  → for each item: attempt to decrement `stock.available`, insert a `reservations` row
  → all items reserved  → publish inventory.reserved
  → any item insufficient → roll back any partial reservations already made for this
    order → publish inventory.failed {reason: "insufficient stock: <productId>"}

Payment consumes inventory.reserved
  → simulate processing delay (PAYMENT_LATENCY_MS_MIN..MAX)
  → simulate failure (PAYMENT_FAILURE_RATE probability, default 0.1)
  → success → insert payments row, publish payment.completed
  → failure → insert payments row (status=failed), publish payment.failed {reason: "card declined"} (a made-up but consistent reason)

Order consumes inventory.reserved → status: pending → inventory_reserved (no event published, this is just an internal state update)
Order consumes inventory.failed   → status: → cancelled, cancel_reason set → publish order.cancelled
Order consumes payment.completed  → status: inventory_reserved → confirmed → publish order.confirmed
Order consumes payment.failed     → status: → cancelled, cancel_reason set → publish order.cancelled

Inventory consumes payment.failed → look up this order's active reservations, add stock
  back to `stock.available`, mark reservations released. No event published — this is
  compensation, not a new business fact.

Notification consumes order.confirmed → log a structured "confirmation email sent" line (mock, no real email)
Notification consumes order.cancelled → log a structured "cancellation email sent" line (mock, no real email)
```

## Order Service (port 4004, Go, PostgreSQL, Kafka producer + consumer)

Table `orders`: `id UUID PK`, `user_id UUID`, `status TEXT` (`pending|inventory_reserved|confirmed|cancelled`), `total_amount NUMERIC`, `cancel_reason TEXT NULL`, `created_at`, `updated_at`.
Table `order_items`: `id UUID PK`, `order_id UUID FK`, `product_id TEXT`, `quantity INT`, `price_snapshot NUMERIC`.

- `POST /orders` — header `X-User-Id` required (`401` if missing). No body. Calls Cart
  service (`CART_SERVICE_URL`) `GET /cart` with the same `X-User-Id` forwarded — `400` if
  cart is empty. Creates the order + items, publishes `order.created`, calls Cart service
  `DELETE /cart`, returns `201 {orderId, status: "pending"}`.
- `GET /orders/:id` — header `X-User-Id` required. `404` if not found or not owned by this
  user. Returns `200 {orderId, status, totalAmount, cancelReason, items: [...], createdAt, updatedAt}`.
- `GET /orders` — header `X-User-Id` required. Returns `200 {orders: [...]}` for that user, newest first.
- `GET /healthz`, `GET /readyz` (Postgres + Kafka broker connectivity), `GET /metrics`.

Env vars: `PORT`, `DATABASE_URL`, `KAFKA_BROKERS`, `CART_SERVICE_URL`.

## Inventory Service (port 4006, Go, PostgreSQL, Kafka producer + consumer)

Table `stock`: `product_id TEXT PK`, `available INT`, `updated_at`.
Table `reservations`: `id UUID PK`, `order_id UUID`, `product_id TEXT`, `quantity INT`, `status TEXT` (`active|released`), `created_at`.

- `GET /inventory/:productId` — `200 {productId, available}` or `404`. Read-only, for debugging/admin use, not called by any other service.
- `POST /inventory` — header `X-Admin-Token` must equal `ADMIN_TOKEN` env var, else `403`. Body `{productId, available}` — upsert. `200`.
- `GET /healthz`, `GET /readyz` (Postgres + Kafka), `GET /metrics`.

Provide `cmd/seed/main.go`: calls the already-running Catalog service (`CATALOG_SERVICE_URL`)
`GET /products` (paginate through all of them), and for each product upserts a `stock` row
with `available = 100`. This means Catalog must be seeded and running before you run this
seed script — document that ordering explicitly in the README.

Env vars: `PORT`, `DATABASE_URL`, `KAFKA_BROKERS`, `ADMIN_TOKEN`, `CATALOG_SERVICE_URL` (seed script only).

## Payment Service (port 4005, Python + FastAPI, PostgreSQL, Kafka producer + consumer via aiokafka)

Table `payments`: `id UUID PK`, `order_id UUID UNIQUE`, `amount NUMERIC`, `status TEXT` (`completed|failed`), `reason TEXT NULL`, `created_at`.

No REST endpoints are called by any other service — this service is Kafka-only, plus health
endpoints for your own operational visibility:
- `GET /healthz`, `GET /readyz` (Postgres + Kafka), `GET /metrics`.
- `GET /payments/{orderId}` — optional, for your own debugging. `200 {status, amount, reason}` or `404`.

Env vars: `PORT`, `DATABASE_URL`, `KAFKA_BROKERS`, `PAYMENT_FAILURE_RATE` (float 0.0-1.0,
default `0.1`), `PAYMENT_LATENCY_MS_MIN` (default `200`), `PAYMENT_LATENCY_MS_MAX` (default `1500`).

## Notification Service (port 4007, Python, Kafka consumer only, no DB)

No REST endpoints besides health/metrics — this service only consumes `order.confirmed` and
`order.cancelled` and logs a structured line simulating an email send (`{"event": "email_sent",
"template": "order_confirmation" | "order_cancellation", "orderId": "...", "to": "mock@example.com"}`).
No real email provider, no outbound HTTP calls.

- `GET /healthz`, `GET /readyz` (Kafka connectivity only — no DB), `GET /metrics`.

Env vars: `PORT`, `KAFKA_BROKERS`.

---

# Phase 5: admin dashboard

A separate admin frontend for the operations that today only exist as raw admin-token-gated
API calls: creating products, adjusting stock, and viewing orders across all users (not just
one, unlike the customer-facing `/orders` page which is scoped to the caller).

## Shared secret change

`ADMIN_TOKEN` was previously allowed to differ per service (Catalog and Inventory each
checked their own value independently). **As of Phase 5, set it to the same value in
`services/catalog/.env`, `services/inventory/.env`, and `services/order/.env`** — the admin
dashboard sends one token and expects it to work against all three. Like `JWT_SECRET`, this
is now a cross-service shared secret, not a per-service one.

## New port

| Service | Port | Env var other services use to reach it |
|---|---|---|
| admin (frontend) | 3001 | not called by any other service |

## Inventory Service — new endpoint

- `GET /inventory?page=&limit=` — header `X-Admin-Token` must equal `ADMIN_TOKEN`, else `403`.
  Returns `200 {items: [{productId, available, updatedAt}], total, page, limit}`. This is
  additive — every existing Inventory endpoint (`GET /inventory/:productId`, `POST /inventory`,
  health/metrics) is unchanged.

## Order Service — new endpoint + new env var

- `GET /admin/orders?page=&limit=&status=` — header `X-Admin-Token` must equal `ADMIN_TOKEN`
  (new env var for this service, not present before Phase 5), else `403`. Returns orders
  across ALL users (unlike `GET /orders`, which is scoped to the caller's `X-User-Id`):
  `200 {orders: [{orderId, userId, status, totalAmount, cancelReason, createdAt}], total, page, limit}`.
  Optional `status` query param filters to one status value. This is additive — every
  existing Order endpoint and its `X-User-Id`-scoped behavior is unchanged. Add `ADMIN_TOKEN`
  to `services/order/.env.example`.

## API Gateway — three new routes, all passthrough (no JWT)

Admin routes use `X-Admin-Token`, not JWT — the gateway does NOT verify this token itself,
it passes the header through untouched and lets the downstream service validate it (same
"gateway doesn't own this credential" pattern as `/api/auth/*`). Add these as three separate
route plugins, mirroring the existing proxy plugin pattern exactly — do not touch any
existing route:

- `/api/admin/products/*` → strip `/api/admin` → proxy to `CATALOG_SERVICE_URL/products*`.
- `/api/admin/inventory/*` → strip `/api/admin` → proxy to `INVENTORY_SERVICE_URL/inventory*`. **New env var**: `INVENTORY_SERVICE_URL` (Inventory was Kafka-only before Phase 5 and was never called synchronously by the gateway — default `http://localhost:4006`).
- `/api/admin/orders/*` → strip `/api` only (keep the `/admin` segment) → proxy to `ORDER_SERVICE_URL/admin/orders*`.

Do not add `/readyz` checks for these — Catalog, Inventory, and Order's health are already
checked there from earlier phases.

## Admin Frontend (port 3001, Next.js 14+ App Router, TypeScript, Tailwind CSS)

A separate app from the customer storefront — separate deployable, separate auth model
(static admin token, not a customer JWT), separate directory (`admin/`, sibling to
`frontend/`). Do not put this inside `frontend/`.

Talks ONLY to the gateway via `NEXT_PUBLIC_API_URL` (default `http://localhost:8080/api`).

Auth: `/login` — a single field for the admin token. On submit, verify it works by calling
`GET /api/admin/inventory?limit=1` (any admin endpoint) and checking for a non-403 response,
then store the token in an httpOnly cookie (`admin_token`) via a Route Handler
(`/app/api/session/route.ts`), following the same server-side-cookie pattern the storefront
already uses for its JWT — do not store it in localStorage. Every subsequent admin API call
reads the cookie server-side and attaches `X-Admin-Token: <token>`.

Pages:
- `/login` — token entry form.
- `/` — dashboard home: summary tiles for total orders and a count per status (pending,
  inventory_reserved, confirmed, cancelled), computed by fetching `GET /api/admin/orders`
  and tallying client-side (no new aggregation endpoint needed) — and a total product count
  from the existing public `GET /api/products` (no admin token needed for reads, it's public
  browsing, same as the storefront uses).
- `/products` — list from the existing public `GET /api/products`, plus a "create product"
  form that `POST`s to `/api/admin/products` (token attached server-side).
- `/inventory` — list from `GET /api/admin/inventory`, plus an inline "set stock" form per
  row (or a simple add-row form) that `POST`s to `/api/admin/inventory`.
- `/orders` — list from `GET /api/admin/orders`, showing `orderId`, `userId`, `status`
  (color-coded, matching the status vocabulary from the storefront's `/orders/[id]` page),
  `totalAmount`, `createdAt`. Optional status filter dropdown.

No edit/delete flows needed — create and list only, keeping scope bounded. Reuse the same
loading/error/empty-state conventions and API client style as `frontend/` (same shape of
`ApiError`, same fetch-wrapper pattern) even though this is a separate app — don't invent a
different convention just because it's a new codebase.

Deliverables: `package.json`, `.env.example` (`NEXT_PUBLIC_API_URL`), multi-stage `Dockerfile`
(non-root), `README.md` (run instructions, env vars, page list, and the note that
`ADMIN_TOKEN` must match what Catalog/Inventory/Order are configured with).

---

# Phase 4: distributed tracing (OpenTelemetry)

Every backend service (not the Storefront or Admin frontends — this phase is about tracing
the backend saga, not browser-side rendering) gets OpenTelemetry instrumentation so a single
checkout request can be followed end-to-end: Gateway → Order → Kafka → Inventory → Kafka →
Payment → Kafka → Order → Kafka → Notification, as one trace, not nine disconnected ones.

## Cross-cutting OTel conventions (every service, no exceptions)

- **Exporter protocol: OTLP over HTTP**, not gRPC — simpler dependency footprint, consistent
  across all three languages. Every SDK reads the endpoint from the **standard** env var
  `OTEL_EXPORTER_OTLP_ENDPOINT` (don't invent a custom var name — this one is part of the
  OTel spec itself and every SDK already knows to read it). Default for local dev:
  `http://localhost:4318`.
- **Service name: standard env var `OTEL_SERVICE_NAME`**, also spec-defined and auto-read by
  every SDK. Default per service: `auth-service`, `cart-service`, `gateway`,
  `catalog-service`, `order-service`, `inventory-service`, `payment-service`,
  `notification-service`.
- **Sampling: always-on (100%)**. This is a practice app with low traffic — document this as
  a deliberate simplification in each README, not a production default (real systems sample
  far below 100% to control cost/volume).
- **Propagation format: W3C Trace Context (the OTel SDK default)** — use the SDK's built-in
  propagator, do not hand-roll a custom header/field scheme. This is what makes a trace
  started in a Go service correctly continue in a Python service: both speak the same
  standard `traceparent` format without needing to agree on anything custom.
- Every service's `/readyz` and startup logs are unaffected by this phase — tracing is
  additive instrumentation, not a dependency anything else waits on. If the OTLP endpoint is
  unreachable, spans should be dropped/logged as a warning, never block or crash the service.

## HTTP propagation — auto-instrumentation, no manual code

For every synchronous HTTP hop (Storefront→Gateway is out of scope, but Gateway→Auth,
Gateway→Catalog, Gateway→Cart, Gateway→Order, Order→Cart), use each language's official
auto-instrumentation package for the HTTP client/server and framework in use. These packages
inject/extract the W3C `traceparent` header automatically — you should not need to write any
manual header-passing code for HTTP. See the per-service sections below for exact packages.

## Kafka propagation — manual, and this is the part to get right

Kafka headers are the only way trace context survives the hop from a producer to a consumer,
since there's no HTTP request carrying it. **Every service that produces or consumes a Kafka
event must add exactly one new header to the messages it already produces, and read it on
every message it consumes:**

- **Header key**: `traceparent` (string key, UTF-8-encoded byte value — same string format as
  the W3C HTTP header, e.g. `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`).
- **Do NOT put trace context inside the JSON `data` payload or the event envelope.** The
  envelope shape from the Phase 2 section (`eventId`, `eventType`, `orderId`, `occurredAt`,
  `data`) is unchanged — trace context rides purely in the Kafka message's native headers,
  alongside the existing `orderId` partition key. This means Phase 2's contract and every
  consumer's JSON parsing is untouched by this phase.
- **On produce**: before publishing, use the OTel SDK's propagator `Inject` function with a
  small carrier adapter wrapping the Kafka client library's native header list, so the
  current active span's context gets written into a `traceparent` header on that message.
  Then create/end a span representing the publish itself, named `<topic> publish` (e.g.
  `order.created publish`), following OTel messaging semantic conventions.
- **On consume**: before processing a message, use the propagator's `Extract` function on
  that same carrier adapter to pull the `traceparent` header back out, and use the resulting
  context as the parent when starting a new span for handling that message, named
  `<topic> process` (e.g. `order.created process`). This is what makes the consumer's work
  show up as part of the same trace the producer started, instead of a new root trace.
- **Verify this live, not just by reading the code.** Produce a real message with a real
  span's context injected, consume it in the same test, and confirm the extracted trace ID
  equals the injected one. A silent mismatch here doesn't error — it just produces
  disconnected traces, which is exactly the failure mode this phase exists to avoid. Also
  wire up (at least temporarily, for your own verification) a console span exporter, which
  every OTel SDK supports, so you can see spans being created with the right names/attributes
  without needing a full tracing backend running.

## Per-service instrumentation

**Auth, Cart, Gateway (Node.js/TypeScript, HTTP only, no Kafka)**
- `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node` (a meta-package
  bundling HTTP, Fastify, pg, redis instrumentation — this covers all three services' actual
  dependencies), `@opentelemetry/exporter-trace-otlp-http`.
- Initialize the SDK as early as possible in each service's entrypoint (before other imports
  that create the things being instrumented), reading `OTEL_EXPORTER_OTLP_ENDPOINT` and
  `OTEL_SERVICE_NAME` from env (the SDK does this automatically — you mainly need to call
  `sdk.start()`).
- No manual span code needed — auto-instrumentation covers HTTP server, HTTP client (the
  gateway's proxying, Cart's calls to Catalog), and the Postgres/Redis clients already in use.

**Catalog (Go, HTTP + MongoDB, no Kafka)**
- `go.opentelemetry.io/otel`, `go.opentelemetry.io/otel/sdk`,
  `go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp`,
  `go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp` (wrap the chi router's
  handler), MongoDB driver instrumentation if a maintained contrib package exists for the
  driver version in use — otherwise wrap the DB calls with a manual span, don't block on
  finding a package.

**Order, Inventory (Go, HTTP + PostgreSQL + Kafka producer AND consumer)**
- Same Go packages as Catalog, plus `go.opentelemetry.io/otel/propagation` for the Kafka
  carrier adapter described above. Order is the most saga-central service — it produces
  `order.created`/`order.confirmed`/`order.cancelled` and consumes all four saga events, so
  its trace propagation code touches the most call sites. Take care that a single incoming
  event's processing (e.g. `payment.completed` triggering `order.confirmed`) correctly
  continues the trace from the *original* checkout request, not a new one — the trace that
  started at `POST /orders` should still be the same trace all the way through, even several
  Kafka hops later.

**Payment (Python/FastAPI, HTTP + PostgreSQL + Kafka producer AND consumer)**
- `opentelemetry-sdk`, `opentelemetry-api`, `opentelemetry-exporter-otlp-proto-http`,
  `opentelemetry-instrumentation-fastapi`. Kafka carrier adapter wraps `aiokafka`'s header
  list (`List[Tuple[str, bytes]]`) using `opentelemetry.propagate`'s inject/extract with a
  custom `Getter`/`Setter` pair.

**Notification (Python, Kafka consumer only, no HTTP business logic)**
- Same Python packages minus the FastAPI instrumentation (this service's HTTP surface is just
  health/metrics, not worth auto-instrumenting). Only needs the consume-side half of the
  Kafka carrier adapter — it never produces events, so no inject-side code needed here.

## Scope note

Standing up the actual tracing backend that receives these spans (Jaeger, Tempo, or
whatever's chosen) is deployment work, same as everything else in this repo — out of scope
for this phase's code. Each service only needs to know where to send spans
(`OTEL_EXPORTER_OTLP_ENDPOINT`), not what's on the other end of that address.
