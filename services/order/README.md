# Order Service

Go + chi + PostgreSQL + Kafka microservice that owns the checkout saga for
the ecommerce-sre-app practice system. Part of Phase 2 — see
`shared/CONTRACTS.md` at the repo root for the full cross-service contract
(envelope shape, topic ownership, and the saga walkthrough this service
implements).

## What this service does

`POST /orders` reads the caller's cart from the Cart service, creates an
order (`status: pending`) plus its line items in Postgres, publishes an
`order.created` event to Kafka, clears the cart, and returns immediately —
it does **not** wait for the saga to finish. The order stays `pending`
until Inventory and Payment (built separately, against the same contract)
react to `order.created` and publish their own events back.

A background Kafka consumer — running on its own goroutine, started at
boot, independent of the HTTP server — subscribes to `inventory.reserved`,
`inventory.failed`, `payment.completed`, and `payment.failed` (consumer
group `order-service`) and drives the order through its state machine:

```
pending --(inventory.reserved)--> inventory_reserved --(payment.completed)--> confirmed
pending --(inventory.failed)-----------------------------------------------> cancelled
inventory_reserved --(payment.failed)---------------------------------------> cancelled
```

`inventory_reserved` is an internal transition only — no event is
published for it. Reaching `confirmed` publishes `order.confirmed`;
reaching `cancelled` (from either failure path) publishes `order.cancelled`
with a `cancelReason`. Every transition is a conditional `UPDATE ... WHERE
status = <expected prior status>`, so a duplicate or out-of-order delivery
(Kafka is at-least-once) is a logged no-op instead of a double transition
or a duplicate re-publish.

This service also creates `order.created`, `order.confirmed`, and
`order.cancelled` on startup (idempotently, via the Kafka admin client,
with retry/backoff if the broker isn't up yet) since it's the producer
for those three topics. It only *consumes* the `inventory.*` / `payment.*`
topics — those are created by the Inventory and Payment services, which own
producing them.

## Trust boundary

This service trusts the API gateway to have already verified the caller's
JWT and injected `X-User-Id`. It does not verify JWTs itself. In production
this service should only be reachable from the gateway (TODO: enforce with
a Kubernetes NetworkPolicy in a later phase).

## Requirements

- Go 1.26+
- A running PostgreSQL instance reachable at `DATABASE_URL`
- A running Kafka broker (or cluster) reachable at `KAFKA_BROKERS`
- A running Cart service reachable at `CART_SERVICE_URL` — `POST /orders`
  calls it synchronously to read and clear the caller's cart
- An `ADMIN_TOKEN` value (shared with Catalog and Inventory as of Phase 5) —
  required at startup, gates `GET /admin/orders`

Start Postgres and Kafka (and the Cart service) *before* starting this
service — `/readyz` will report `503` until both are reachable, and
`POST /orders` will fail if the Cart service isn't up.

## Configuration

All configuration is via environment variables — see `.env.example` for the
full list with safe dummy defaults:

| Variable            | Description                                              | Default                                                          |
|---------------------|-----------------------------------------------------------|-------------------------------------------------------------------|
| `PORT`               | HTTP port the server listens on                          | `4004`                                                             |
| `DATABASE_URL`       | PostgreSQL connection string                             | none — **required**, no default                                   |
| `KAFKA_BROKERS`      | Comma-separated Kafka broker addresses                   | `localhost:9092`                                                   |
| `CART_SERVICE_URL`   | Base URL of the Cart service                             | none — **required**, no default                                   |
| `ADMIN_TOKEN`         | Static admin token gating `GET /admin/orders` (`X-Admin-Token` header must match, else `403`). As of Phase 5, must be the same value configured in Catalog and Inventory. | none — **required**, no default |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base URL of the OTLP/HTTP collector spans are exported to (standard OTel env var, read automatically by the SDK) | `http://localhost:4318` |
| `OTEL_SERVICE_NAME`   | Service name attached to every span (standard OTel env var, read automatically by the SDK) | `order-service` |

Copy `.env.example` to `.env` and adjust as needed, then export the
variables into your shell before running (this project does not load `.env`
automatically — no dotenv dependency is included).

## Running locally

```bash
# 1. Start PostgreSQL and Kafka (any local setup works, e.g. throwaway
#    docker containers), and make sure the Cart service is running too.

# 2. Export config
export PORT=4004
export DATABASE_URL="postgres://order:order@localhost:5432/order?sslmode=disable"
export KAFKA_BROKERS="localhost:9092"
export CART_SERVICE_URL="http://localhost:4003"
export ADMIN_TOKEN="changeme"
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
export OTEL_SERVICE_NAME="order-service"

# 3. Run the server
go run ./cmd/server
```

On startup the server: connects to Postgres, applies the schema migration
(idempotent — safe to run on every boot), ensures its Kafka topics exist
(retrying with backoff if the broker isn't reachable yet), starts the HTTP
server, and starts the background saga consumer.

## Database schema

`migrations/001_create_orders.sql` creates the `orders` and `order_items`
tables (both idempotent `CREATE TABLE IF NOT EXISTS`). You can apply it by
hand with `psql`:

```bash
psql "$DATABASE_URL" -f migrations/001_create_orders.sql
```

...or just start the server — it applies the same SQL (embedded into the
binary) on every boot before serving traffic, so a manual `psql` step is
optional, not required.

## Tracing

This service is instrumented with OpenTelemetry per the "Phase 4: distributed
tracing" section of `shared/CONTRACTS.md`, so a single checkout request can be
followed end-to-end across Gateway → Order → Kafka → Inventory → Kafka →
Payment → Kafka → Order → Kafka → Notification as one trace.

- **Exporter**: OTLP over HTTP (`go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp`),
  sent to `OTEL_EXPORTER_OTLP_ENDPOINT` (standard OTel env var, default
  `http://localhost:4318`). No tracing backend is stood up by this repo —
  point that var at whatever collector (Jaeger, Tempo, etc.) you run
  yourself; standing one up is deployment work, out of scope here.
- **Service name**: `OTEL_SERVICE_NAME` (standard OTel env var, default
  `order-service`).
- **Sampling**: always-on (100%) — a deliberate simplification for this
  low-traffic practice app, **not** a production default (real systems
  sample far below 100% to control cost/volume).
- **HTTP**: the synchronous business-logic routes (`POST /orders`,
  `GET /orders`, `GET /orders/:id`, `GET /admin/orders`) are wrapped with
  `otelhttp`, OTel's official chi/net-http auto-instrumentation, which
  injects/extracts the W3C `traceparent` header automatically — no manual
  header-passing code. Health/readiness/metrics endpoints are intentionally
  excluded (not part of any distributed trace, and scraped/polled too often
  to be worth tracing).
- **Kafka (manual, the part that actually matters)**: since a Kafka message
  carries no HTTP request to auto-instrument, trace context is propagated by
  hand via a small `propagation.TextMapCarrier` adapter
  (`internal/kafka.HeaderCarrier`) wrapping segmentio/kafka-go's native
  `[]kafka.Header` list:
  - **Produce** (`order.created`, `order.confirmed`, `order.cancelled`):
    `otel.GetTextMapPropagator().Inject` writes a `traceparent` header
    (W3C format, e.g. `00-<trace-id>-<span-id>-01`) onto the outgoing
    message using whatever trace context is active in the caller's
    `context.Context`, and the publish itself is wrapped in a
    `<topic> publish` span.
  - **Consume** (`inventory.reserved`, `inventory.failed`,
    `payment.completed`, `payment.failed`): `otel.GetTextMapPropagator().Extract`
    reads the `traceparent` header back out **before** starting a
    `<topic> process` span, so that span — and the context passed to the
    saga state-machine handler — is a child of the *original* trace, not a
    new root. This is what makes e.g. `payment.completed` triggering
    `order.confirmed` show up as one continuous trace all the way back to
    the `POST /orders` call that started it, several Kafka hops earlier,
    rather than a disconnected trace per hop.
  - Trace context rides purely in Kafka message headers — the `traceparent`
    header is not part of the JSON event envelope (`eventId`/`eventType`/
    `orderId`/`occurredAt`/`data`), which is unchanged from Phase 2.
- **Failure handling**: an unreachable OTLP collector never blocks startup or
  request handling — export happens asynchronously in a batch span
  processor, and failures are logged as a `warn`-level structured log line,
  never a crash.

**Verified live** (see also "Verification notes" below): a throwaway
Postgres + Kafka pair was started locally, the server was run with the OTel
SDK's console span exporter temporarily wired in alongside OTLP, and a small
standalone harness injected a real W3C trace context into a hand-crafted
`payment.completed` Kafka message (simulating what the Payment service's
producer does) before publishing it. Confirmed via the console-exported
spans and a throwaway readback consumer on `order.confirmed`:
- The `payment.completed process` span's trace ID matched the injected
  trace ID exactly, and its parent span ID matched the injected span ID —
  a genuine remote child, not a coincidental match.
- The `order.confirmed publish` span this handler produced was a child of
  that same `payment.completed process` span (same trace ID, correct
  parent/child span IDs).
- The actual outgoing `order.confirmed` Kafka message's `traceparent`
  header, read back with an independent throwaway consumer, carried that
  same trace ID — confirming the trace continues correctly not just inside
  the process's in-memory spans but in what actually goes over the wire to
  the next saga hop.

## Building

```bash
go build ./...
go vet ./...
```

## Docker

```bash
docker build -t order-service .
docker run --rm -p 4004:4004 \
  -e DATABASE_URL=postgres://order:order@host.docker.internal:5432/order?sslmode=disable \
  -e KAFKA_BROKERS=host.docker.internal:9092 \
  -e CART_SERVICE_URL=http://host.docker.internal:4003 \
  -e ADMIN_TOKEN=changeme \
  order-service
```

The image is a multi-stage build producing a minimal static binary on
Alpine, running as a non-root `order` user.

## Endpoints

### Cross-cutting

| Method | Path       | Description                                                        |
|--------|------------|---------------------------------------------------------------------|
| GET    | `/healthz` | Liveness probe. Always `200 {"status":"ok"}` if the process is up. |
| GET    | `/readyz`  | Readiness probe. Checks **both** Postgres and Kafka broker connectivity; `200 {"status":"ready"}` or `503 {"status":"not-ready","reason":"..."}`. |
| GET    | `/metrics` | Prometheus exposition format: HTTP request count/duration/error metrics, plus Kafka events produced/consumed counters. |

### Orders

All three endpoints require header `X-User-Id` (injected by the gateway) —
`401` if missing.

| Method | Path           | Description |
|--------|----------------|--------------|
| POST   | `/orders`      | No body. Reads the caller's cart (`GET /cart` on `CART_SERVICE_URL`, forwarding `X-User-Id`) — `400` if empty. Creates the order (`status: pending`) + items, publishes `order.created`, clears the cart (`DELETE /cart`), and returns `201 {orderId, status: "pending"}` **without** waiting for the saga. |
| GET    | `/orders/:id`  | `404` if not found or not owned by this user. Returns `200 {orderId, status, totalAmount, cancelReason, items: [{productId, quantity, priceSnapshot}], createdAt, updatedAt}`. |
| GET    | `/orders`      | Returns `200 {orders: [...]}` for the caller, newest first, each in the same shape as `GET /orders/:id`. |

### Admin (Phase 5)

Requires header `X-Admin-Token` equal to the `ADMIN_TOKEN` env var — `403`
if missing or wrong. Unlike the `/orders` endpoints above, this is **not**
scoped by `X-User-Id` — it returns orders across all users, for the admin
dashboard.

| Method | Path           | Description |
|--------|----------------|--------------|
| GET    | `/admin/orders` | Query params `page` (default `1`), `limit` (default `20`, max `100`), and optional `status` (one of `pending`, `inventory_reserved`, `confirmed`, `cancelled`) to filter. Returns `200 {orders: [{orderId, userId, status, totalAmount, cancelReason, createdAt}], total, page, limit}`, newest first. Line items are omitted — this is a list view, not the per-order detail `GET /orders/:id` gives. |

## Project layout

```
cmd/server/          main.go — HTTP server + background Kafka consumer entrypoint
migrations/          001_create_orders.sql (orders + order_items schema), embedded via go:embed
internal/config/     environment variable loading
internal/db/         Postgres connection pool, schema migration, Order/OrderItem repository
internal/kafka/      event envelope + topic/event-type constants, producer (topic creation,
                      publish + traceparent injection), consumer (the saga state machine +
                      traceparent extraction), HeaderCarrier (Kafka header <-> OTel
                      TextMapCarrier adapter)
internal/cartclient/ HTTP client for the Cart service (GET/DELETE /cart)
internal/handlers/   HTTP handlers + chi router wiring (otelhttp-wrapped routes)
internal/middleware/ request logging + Prometheus instrumentation
internal/metrics/    Prometheus collector definitions
internal/models/     Order domain types + API response shapes
internal/logging/    zap structured JSON logger setup
internal/tracing/    OpenTelemetry SDK/exporter/propagator setup (see "Tracing" above)
```

## Verification notes

Built and smoke-tested against throwaway local Postgres and single-node
KRaft Kafka containers (plus a stub Cart service): `POST /orders` was
confirmed to create the order row, publish a correctly-shaped `order.created`
envelope (`eventId`/`eventType`/`orderId`/`occurredAt`/`data`, keyed by
`orderId`), and clear the cart. Manually publishing `inventory.reserved`,
`inventory.failed`, `payment.completed`, and `payment.failed` events (in
place of the not-yet-integrated Inventory/Payment services) confirmed all
four saga transitions, the resulting `order.confirmed` / `order.cancelled`
publishes, and that duplicate deliveries are correctly logged as no-ops
rather than re-applied or re-published.

**Phase 5 addition** (`GET /admin/orders`): smoke-tested against a throwaway
local Postgres seeded with orders across three different users and four
different statuses. Confirmed: no `X-Admin-Token` header and a wrong token
both return `403 {"error":"forbidden"}`; a valid token returns `200` with
orders spanning all three users (not scoped to one caller); the `status`
query param correctly filters to a single status; and `page`/`limit`
pagination returns the right slice with an accurate `total` count.
