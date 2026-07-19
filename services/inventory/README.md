# Inventory Service

Go + chi + PostgreSQL + Kafka microservice that owns stock levels and order
reservations for the ecommerce-sre-app practice system. Part of Phase 2 —
see `shared/CONTRACTS.md` at the repo root for the full cross-service
contract (Kafka conventions, topic ownership, and the saga walkthrough).

This service has no synchronous callers — it is Kafka-only for the checkout
saga, plus a small REST surface for admin/debugging.

## Trust boundary

`POST /inventory` and `GET /inventory` (the paginated listing, added in
Phase 5) are protected only by a static `X-Admin-Token` header check, same
pattern as Catalog's `POST /products` — sufficient for seeding data and
powering the admin dashboard in this practice project, not a real
authorization system. `GET /inventory/:productId` is unauthenticated
read-only, for debugging. None of these endpoints are called by any other
service. (TODO for a later phase: restrict network access to this service
with a Kubernetes NetworkPolicy.)

## Run order

This service depends on other pieces being up first:

1. **PostgreSQL** reachable at `DATABASE_URL` — the server applies
   migrations (`migrations/*.sql`) automatically on startup.
2. **Kafka** reachable at `KAFKA_BROKERS` — the server creates the
   `inventory.reserved` and `inventory.failed` topics on startup
   (idempotent, retries with backoff if the broker isn't up yet).
3. Once the server is up, it consumes `order.created` and `payment.failed`
   in the background — no further setup needed for the saga to work.

For **`cmd/seed`** specifically, there is an additional dependency:

4. **The Catalog service must already be running and already seeded**
   (`go run ./cmd/seed` in `services/catalog`) before you run this
   service's seed script. `inventory`'s seed script calls Catalog's `GET
   /products` to discover which product IDs exist, then upserts a `stock`
   row (`available = 100`) for each one. If Catalog has no products yet,
   this seed script will simply seed nothing.

## Requirements

- Go 1.26+
- A running PostgreSQL instance reachable at `DATABASE_URL`
  (e.g. `docker run -p 5432:5432 -e POSTGRES_PASSWORD=inventory -e POSTGRES_USER=inventory -e POSTGRES_DB=inventory postgres:16`)
- A running Kafka broker reachable at `KAFKA_BROKERS`
- For `cmd/seed` only: a running, already-seeded Catalog service reachable
  at `CATALOG_SERVICE_URL`

## Configuration

All configuration is via environment variables — see `.env.example` for the
full list with safe dummy defaults:

| Variable              | Description                                                          | Default                                                |
|------------------------|-----------------------------------------------------------------------|---------------------------------------------------------|
| `PORT`                 | HTTP port the server listens on                                       | `4006`                                                   |
| `DATABASE_URL`         | PostgreSQL connection string                                          | `postgres://inventory:inventory@localhost:5432/inventory` |
| `KAFKA_BROKERS`        | Comma-separated Kafka broker address(es)                              | `localhost:9092`                                         |
| `ADMIN_TOKEN`          | Required token for `X-Admin-Token` header on `POST /inventory`        | none — **required**, no default                          |
| `CATALOG_SERVICE_URL`  | Catalog service base URL — **only used by `cmd/seed`**                | `http://localhost:4002`                                  |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP-over-HTTP collector base URL (scheme + host + port); `/v1/traces` is appended automatically by the exporter | `http://localhost:4318` |
| `OTEL_SERVICE_NAME`    | Service name attached to every span this service emits                | `inventory-service`                                       |

Copy `.env.example` to `.env` and adjust as needed, then export the
variables into your shell before running (this project does not load `.env`
automatically — no dotenv dependency is included).

## Running locally

```bash
# 1. Make sure PostgreSQL and Kafka are running and reachable.
docker run -d --name inventory-postgres -p 5432:5432 \
  -e POSTGRES_USER=inventory -e POSTGRES_PASSWORD=inventory -e POSTGRES_DB=inventory \
  postgres:16
# (bring up Kafka however you're doing that for the rest of the stack)

# 2. Export config (or use `set -a && source .env && set +a`)
export PORT=4006
export DATABASE_URL=postgres://inventory:inventory@localhost:5432/inventory
export KAFKA_BROKERS=localhost:9092
export ADMIN_TOKEN=dev-token
export CATALOG_SERVICE_URL=http://localhost:4002

# 3. Run the server
go run ./cmd/server
```

The server listens on `PORT` (default `4006`), applies migrations, creates
its Kafka topics, and starts consuming `order.created` / `payment.failed` in
the background. It logs structured JSON to stdout.

## Seeding stock

**Catalog must already be running and seeded first** (see "Run order"
above). With the same environment variables exported, run:

```bash
go run ./cmd/seed
```

This paginates through Catalog's `GET /products`, and for every product ID
it finds, upserts a `stock` row with `available = 100`. Safe to re-run — it
always upserts (`ON CONFLICT (product_id) DO UPDATE`), so re-running just
resets every known product back to 100 units rather than creating
duplicates.

## Building

```bash
go build ./...
go vet ./...
```

## Docker

```bash
docker build -t inventory-service .
docker run --rm -p 4006:4006 \
  -e DATABASE_URL=postgres://inventory:inventory@host.docker.internal:5432/inventory \
  -e KAFKA_BROKERS=host.docker.internal:9092 \
  -e ADMIN_TOKEN=dev-token \
  inventory-service
```

The image is a multi-stage build producing minimal static binaries on
Alpine, running as a non-root `inventory` user. It builds both the server
(`ENTRYPOINT`) and the seed binary (`/app/inventory-seed`, run manually with
`docker run --rm ... inventory-service /app/inventory-seed` if you want to
seed from inside a container).

## Endpoints

### Cross-cutting

| Method | Path       | Description                                                        |
|--------|------------|---------------------------------------------------------------------|
| GET    | `/healthz` | Liveness probe. Always `200 {"status":"ok"}` if the process is up. |
| GET    | `/readyz`  | Readiness probe. Checks PostgreSQL and Kafka; `200 {"status":"ready"}` or `503 {"status":"not-ready","reason":"..."}`. |
| GET    | `/metrics` | Prometheus exposition format: request count, request duration histogram, error count, plus Kafka events produced/consumed counters. |

### Inventory

| Method | Path                     | Description                                                                 |
|--------|--------------------------|-------------------------------------------------------------------------------|
| GET    | `/inventory?page=&limit=` | Paginated stock listing, ordered by `product_id`. Requires header `X-Admin-Token: <ADMIN_TOKEN>`, else `403`. Returns `200 {items: [{productId, available, updatedAt}], total, page, limit}`. `page` defaults to `1`, `limit` defaults to `20` (capped at `100`). Added in Phase 5 for the admin dashboard. |
| GET    | `/inventory/:productId`  | Read-only stock lookup. Returns `200 {productId, available}` or `404`. Not called by any other service — for debugging/admin use. |
| POST   | `/inventory`             | Upsert a stock row. Requires header `X-Admin-Token: <ADMIN_TOKEN>`, else `403`. Body `{productId, available}` → `200`. |

## The reserve/release saga

This service has no HTTP-triggered business logic — the interesting work
happens in its background Kafka consumer (consumer group
`inventory-service`), subscribed to `order.created` and `payment.failed`.

**On `order.created`** (`data: {userId, items, totalAmount}`):

1. Idempotency guard: if any `reservations` row already exists for this
   `orderId` (from a prior delivery of the same event), skip entirely and
   log a "duplicate ignored" line. This is what makes redelivery safe —
   Kafka is at-least-once, so the same `order.created` can arrive twice.
2. Otherwise, for each line item in `data.items`, atomically attempt to
   decrement `stock.available` (`UPDATE ... WHERE available >= quantity`)
   and, if that succeeds, insert an `active` `reservations` row.
3. If every item reserved successfully, publish `inventory.reserved` with
   `data.items = [{productId, quantity}]`.
4. If any item comes up short, stop there and **roll back** every
   reservation already made for this order in step 2 — restoring their
   stock and marking them `released` — then publish `inventory.failed` with
   `data.reason = "insufficient stock: <productId>"` naming the item that
   ran out.

**On `payment.failed`** (`data: {reason, amount}`):

1. Look up this order's currently `active` reservations.
2. For each one, atomically transition it to `released` and add its
   quantity back to `stock.available`. The transition is conditioned on
   `status = 'active'` in the same `UPDATE`, so a duplicate `payment.failed`
   delivery (or one that arrives after this order was already released for
   some other reason) is a safe no-op rather than double-crediting stock.
3. No event is published — this is compensation, not a new business fact.

Both paths funnel through the same `ReleaseReservation` repository method,
so the "release + restore stock, but only if still active" idempotency
guarantee is implemented once and reused for both saga rollback and
`payment.failed` compensation.

**Known limitation**: if the process crashes mid-way through processing a
single `order.created` (e.g. after reserving item 1 of 2 but before
publishing), redelivery on restart will see the partial `reservations` rows
already present and treat the event as fully handled rather than resuming
it — an accepted gap for a practice project (no outbox pattern here). Kafka
offsets are only committed after a handler returns successfully, so this
only affects the narrow crash window, not the common "duplicate delivery"
case the idempotency guards are built for.

## Tracing

Part of Phase 4 — see `shared/CONTRACTS.md`'s "Phase 4: distributed
tracing (OpenTelemetry)" section for the full cross-service contract. This
service is instrumented with the OpenTelemetry Go SDK so a single checkout
request can be followed end-to-end across the Gateway → Order → Kafka →
Inventory → Kafka → Payment → ... saga as one trace.

- **Exporter**: OTLP over HTTP (`go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp`),
  reading the standard `OTEL_EXPORTER_OTLP_ENDPOINT` env var (default
  `http://localhost:4318` for local dev — see `.env.example`). This is a
  spec-defined env var read automatically by the SDK; there is no
  custom/renamed variable here.
- **Service name**: standard `OTEL_SERVICE_NAME` env var (default
  `inventory-service`), also read automatically by the SDK, attached to
  every span emitted by this process.
- **Sampling**: always-on (100%) — `internal/tracing` sets
  `sdktrace.AlwaysSample()`. This is a deliberate simplification for a
  low-traffic practice app; a real production deployment would sample far
  below 100% to control span volume/cost.
- **Propagation**: W3C Trace Context, via the OTel SDK's built-in
  propagator (`propagation.TraceContext`) — no custom header/field scheme.
- **HTTP**: the three synchronous routes (`GET /inventory`,
  `GET /inventory/:productId`, `POST /inventory`) are each wrapped with
  `otelhttp.NewHandler` (see `internal/handlers/router.go`), which
  auto-extracts/injects the `traceparent` HTTP header — no manual span code
  needed for HTTP. `/healthz`, `/readyz`, `/metrics` are intentionally left
  unwrapped.
- **Kafka (manual propagation)**: Kafka has no HTTP header to carry trace
  context, so this service manually propagates it via a `traceparent`
  Kafka message header (UTF-8 string, same W3C format as the HTTP header),
  using a small adapter (`internal/eventbus/carrier.go`,
  `KafkaHeaderCarrier`) that implements `propagation.TextMapCarrier` over
  `kafka.Header`'s native `[]{Key, Value []byte}` shape:
  - **On consume** (`order.created`, `payment.failed`): the trace context
    is extracted from the message's `traceparent` header *before*
    processing, and a `<topic> process` span (e.g. `order.created
    process`) is started as a child of that extracted context — see
    `internal/eventbus/consumer.go`'s `Run` loop. This is what makes the
    consumer's work part of the same trace the producer started, instead
    of a disconnected root trace.
  - **On publish** (`inventory.reserved`, `inventory.failed`): the
    currently-active span's context (which is the continued trace from
    whichever `order.created` message triggered the publish, per the
    `ctx` threaded through `Service.HandleOrderCreated` →
    `Producer.Publish`) is injected into the outgoing message's
    `traceparent` header, wrapped in a `<topic> publish` span — see
    `internal/eventbus/producer.go`'s `Publish`.
  - **`payment.failed` → reservation release**: this path (`Service.HandlePaymentFailed`)
    never publishes an event (pure compensation, per the saga contract), so
    there'd be nothing to carry the trace forward through. It still
    creates its own child span (`inventory.release`) under the extracted
    `payment.failed` trace context, so the release work remains visible in
    the trace even without a corresponding published event.
  - The Kafka envelope shape (`eventId`, `eventType`, `orderId`,
    `occurredAt`, `data`) is completely untouched by this — trace context
    rides only in the Kafka message's native headers, never in the JSON
    payload.
- **If the OTLP endpoint is unreachable**: span export failures are routed
  to a warning-level log line (`internal/tracing.Init`'s error handler);
  this never blocks or crashes the service, since tracing is additive
  instrumentation, not a startup dependency.
- **Verifying locally**: swap in a console span exporter (every OTel SDK
  supports one) in place of the OTLP exporter to see spans printed to
  stdout without needing a full tracing backend running. This was used
  during development to confirm — with a throwaway Postgres + Kafka and a
  hand-crafted `order.created` message carrying a known injected
  `traceparent` — that the consumed `order.created process` span and the
  subsequently published `inventory.reserved`/`inventory.failed` message's
  `traceparent` header both carry the *same* trace ID as the one injected
  into the original message.

## Project layout

```
cmd/server/           main.go — HTTP server + background Kafka consumer entrypoint
cmd/seed/              main.go — seed script (go run ./cmd/seed)
internal/config/       environment variable loading
internal/db/           PostgreSQL pool, connection/ping helpers, migration runner
internal/eventbus/      Kafka envelope, producer, consumer, topic-admin helpers
internal/handlers/      HTTP handlers + chi router wiring
internal/inventory/     reserve/release business logic + PostgreSQL repository
internal/logging/       zap structured JSON logger setup
internal/metrics/       Prometheus collector definitions
internal/middleware/    request logging + Prometheus instrumentation
internal/models/        Stock/Reservation domain types
internal/tracing/       OpenTelemetry SDK/exporter/propagator initialization (Phase 4)
migrations/             SQL migrations (embedded into the binary via go:embed)
```
