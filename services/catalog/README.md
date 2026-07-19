# Catalog Service

Go + chi + MongoDB microservice that owns product catalog data for the
ecommerce-sre-app practice system. Part of Phase 1 — see
`shared/CONTRACTS.md` at the repo root for the full cross-service contract.

## Trust boundary

This service trusts the API gateway to have already handled auth for any
caller-identity concerns. It does not verify JWTs itself. `POST /products`
is protected only by a static `X-Admin-Token` header check — this is
sufficient for seeding data in Phase 1, not a real authorization system.
In production this service should only be reachable from the gateway
(TODO: enforce with a Kubernetes NetworkPolicy in a later phase).

## Requirements

- Go 1.26+
- A running MongoDB instance reachable at the URI configured in `MONGO_URI`
  (e.g. `docker run -p 27017:27017 mongo:7` or a local `mongod`)

## Configuration

All configuration is via environment variables — see `.env.example` for the
full list with safe dummy defaults:

| Variable                       | Description                                              | Default                       |
|--------------------------------|-------------------------------------------------------------|-------------------------------|
| `PORT`                         | HTTP port the server listens on                           | `4002`                        |
| `MONGO_URI`                    | MongoDB connection string                                 | `mongodb://localhost:27017`   |
| `MONGO_DB_NAME`                | MongoDB database name                                     | `catalog`                     |
| `ADMIN_TOKEN`                  | Required token for `X-Admin-Token` header on `POST /products` | none — **required**, no default |
| `OTEL_EXPORTER_OTLP_ENDPOINT`  | OTLP/HTTP endpoint spans are exported to (standard OTel env var) | `http://localhost:4318`       |
| `OTEL_SERVICE_NAME`            | Service name attached to every span (standard OTel env var) | `catalog-service`             |

Copy `.env.example` to `.env` and adjust as needed, then export the
variables into your shell before running (this project does not load
`.env` automatically — no dotenv dependency is included).

## Running locally

```bash
# 1. Make sure MongoDB is running and reachable at MONGO_URI.
docker run -d --name catalog-mongo -p 27017:27017 mongo:7

# 2. Export config (or use `set -a && source .env && set +a`)
export PORT=4002
export MONGO_URI=mongodb://localhost:27017
export MONGO_DB_NAME=catalog
export ADMIN_TOKEN=dev-token

# 3. Run the server
go run ./cmd/server
```

The server listens on `PORT` (default `4002`) and logs structured JSON to
stdout.

## Seeding sample data

With the same environment variables exported (MongoDB reachable, admin
token set), run:

```bash
go run ./cmd/seed
```

This inserts ~15 sample products spread across four categories
(`electronics`, `apparel`, `home goods`, `books`) into the `products`
collection. Safe to re-run — it always inserts a fresh batch with new IDs,
so re-running will duplicate data if you don't clear the collection first.

## Building

```bash
go build ./...
```

## Docker

```bash
docker build -t catalog-service .
docker run --rm -p 4002:4002 \
  -e MONGO_URI=mongodb://host.docker.internal:27017 \
  -e MONGO_DB_NAME=catalog \
  -e ADMIN_TOKEN=dev-token \
  catalog-service
```

The image is a multi-stage build producing a minimal static binary on
Alpine, running as a non-root `catalog` user.

## Endpoints

### Cross-cutting

| Method | Path       | Description                                                        |
|--------|------------|---------------------------------------------------------------------|
| GET    | `/healthz` | Liveness probe. Always `200 {"status":"ok"}` if the process is up. |
| GET    | `/readyz`  | Readiness probe. Pings MongoDB; `200 {"status":"ready"}` or `503 {"status":"not-ready","reason":"..."}`. |
| GET    | `/metrics` | Prometheus exposition format: request count, request duration histogram, error count. |

### Catalog

| Method | Path             | Description                                                                 |
|--------|------------------|-------------------------------------------------------------------------------|
| GET    | `/products`      | List products. Query params: `category`, `page` (default 1), `limit` (default 20, max 100). Returns `{items, total, page, limit}`. |
| GET    | `/products/:id`  | Get a single product by ID. Returns `{product}` or `404`.                    |
| GET    | `/categories`    | Returns `{categories: [string]}` — the distinct categories currently in the collection. |
| POST   | `/products`      | Create a product. Requires header `X-Admin-Token: <ADMIN_TOKEN>`, else `403`. Body is a product (see below). Returns `201 {id}`. |

`POST /products` request body:

```json
{
  "name": "Wireless Mouse",
  "description": "Ergonomic wireless mouse with USB-C charging.",
  "price": 29.99,
  "category": "electronics",
  "imageUrl": "https://example.com/mouse.jpg",
  "stock": 100
}
```

Product shape returned by `GET` endpoints:

```json
{
  "id": "665f1c2e8b1e2a3d4c5b6a7f",
  "name": "Wireless Mouse",
  "description": "Ergonomic wireless mouse with USB-C charging.",
  "price": 29.99,
  "category": "electronics",
  "imageUrl": "https://example.com/mouse.jpg",
  "stock": 100,
  "createdAt": "2026-07-11T12:00:00Z"
}
```

## Tracing

Catalog is instrumented with [OpenTelemetry](https://opentelemetry.io/) distributed tracing
(Phase 4 — see `shared/CONTRACTS.md`'s "Phase 4: distributed tracing" section for the
cross-service conventions this implements). This is a synchronous-HTTP-plus-MongoDB service
with no Kafka involvement, so there's no manual trace-context carrier code here — everything
rides on standard, automatic mechanisms:

- **HTTP server spans**: the chi router is wrapped with
  [`otelhttp`](https://pkg.go.dev/go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp),
  which creates a server span for every request and automatically extracts the W3C
  `traceparent` header from incoming requests. This is what lets a trace started at the
  Gateway continue into Catalog. Span names are the matched chi route pattern (e.g.
  `GET /products/{id}`, not the raw per-ID URL) so they stay low-cardinality — chi resolves
  the route pattern after `otelhttp` starts the span, so the request-logging middleware
  (`internal/middleware/middleware.go`) renames the span once routing has happened, the same
  place it already reads the route pattern for Prometheus labels.
- **MongoDB spans**: `internal/db/mongo.go` attaches
  [`otelmongo`](https://pkg.go.dev/go.opentelemetry.io/contrib/instrumentation/go.mongodb.org/mongo-driver/mongo/otelmongo)'s
  `CommandMonitor` to the Mongo client. This is a maintained package pinned to exactly the
  `go.mongodb.org/mongo-driver` version already in use here, so no hand-written per-query
  spans were needed — every command (`find`, `aggregate`/`count`, `distinct`, `insertOne`)
  automatically becomes a child span of whichever span is active on the context passed to
  that call, tagged with `db.operation.name` and `db.collection.name`.
- **Exporter**: OTLP over HTTP (`go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp`),
  configured via the standard `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME` env vars,
  read automatically by the Go SDK (see `internal/tracing/tracing.go` for exactly how — the
  service-name fallback of `catalog-service` when the env var is unset is layered on top of
  the SDK's own env detection, since the SDK's built-in fallback is a generic
  `unknown_service:<binary>`, not this service's documented default).
- **Sampling**: always-on (100%). This is a deliberate simplification for this low-traffic
  practice app, **not a production default** — real systems sample well below 100% to control
  cost and export volume.
- **Failure mode**: if the OTLP endpoint is unreachable, span export errors are routed through
  the service's structured logger as `warn`-level `otel error` lines. Tracing is purely
  additive instrumentation — it never blocks a request or crashes the service, and `/readyz`
  is unaffected by exporter availability.

Standing up an actual tracing backend (Jaeger, Tempo, etc.) to receive these spans is out of
scope for this service — it only needs to know where to send them.

## Project layout

```
cmd/server/       main.go — HTTP server entrypoint
cmd/seed/         main.go — seed script (go run ./cmd/seed)
internal/config/  environment variable loading
internal/db/      MongoDB client + connection/ping helpers (otelmongo-instrumented)
internal/handlers/HTTP handlers + chi router wiring (otelhttp-instrumented)
internal/middleware/ request logging + Prometheus instrumentation + span route-naming
internal/metrics/ Prometheus collector definitions
internal/models/  Product domain types + request/response shapes
internal/logging/ zap structured JSON logger setup
internal/tracing/ OpenTelemetry SDK setup (OTLP/HTTP exporter, W3C propagation)
```
