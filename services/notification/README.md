# Notification Service

Notification microservice for the e-commerce SRE practice app (Phase 2). Python +
FastAPI, `aiokafka`. This is the simplest consumer in the checkout saga: it has no
database and (besides health/metrics) no REST surface — it just listens to Kafka and
logs a mock "email sent" line.

## What it does

Runs a background Kafka consumer, subscribed to:

- `order.confirmed` → logs a structured line simulating a confirmation email:
  ```json
  {"event": "email_sent", "template": "order_confirmation", "orderId": "...", "to": "mock@example.com"}
  ```
- `order.cancelled` → same pattern with `"template": "order_cancellation"`.

Consumer group id: `notification-service`.

**Email sending is entirely mocked.** There is no real email provider integration and
no outbound HTTP calls are made — "sending an email" here means writing the structured
log line above to stdout. This is intentional per `shared/CONTRACTS.md`.

This service does **not** create the `order.confirmed` / `order.cancelled` topics — the
Order service owns and creates them. Notification only consumes.

## Running locally

Prerequisites:

- Python 3.12+
- A running Kafka broker reachable at `KAFKA_BROKERS` (that's the only dependency —
  no database)

Steps:

```bash
cp .env.example .env
# edit .env if your Kafka broker address differs from the default

python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python -m app.main
```

The service listens on `PORT` (default `4007`) for health/metrics only. The Kafka
consumer starts in the background alongside the HTTP server and reconnects with
backoff if the broker isn't reachable yet.

## Environment variables

| Var | Required | Default | Description |
|---|---|---|---|
| `PORT` | no | `4007` | HTTP port for `/healthz`, `/readyz`, `/metrics` |
| `KAFKA_BROKERS` | no | `localhost:9092` | Comma-separated Kafka broker addresses |
| `LOG_LEVEL` | no | `info` | structlog level (`debug`\|`info`\|`warning`\|`error`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | `http://localhost:4318` | OTLP/HTTP endpoint spans are exported to. Standard OTel env var, read automatically by the exporter. |
| `OTEL_SERVICE_NAME` | no | `notification-service` | Service name attached to every span's resource attributes. Standard OTel env var. |

See `.env.example` for a ready-to-copy template.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/healthz` | Liveness — always `200 {"status":"ok"}`, no dependency checks |
| `GET` | `/readyz` | Readiness — checks Kafka consumer connectivity only (no DB). `200 {"status":"ready"}` or `503 {"status":"not-ready","reason":"..."}` |
| `GET` | `/metrics` | Prometheus exposition format: HTTP request count/duration/errors, plus `kafka_events_consumed_total`, `kafka_consumer_errors_total`, `mock_emails_sent_total` |

## Logs

All logs are structured JSON on stdout (one object per line) via `structlog`, with
`timestamp`, `level`, `service`, `message` plus context fields — consistent with the
rest of the app. Every consumed Kafka event is logged (`eventId`, `eventType`,
`orderId`) in addition to the mock email-sent line described above.

## Module layout

```
app/
  main.py            FastAPI app: /healthz, /readyz, /metrics, lifecycle wiring
  kafka_consumer.py   Background aiokafka consumer (order.confirmed / order.cancelled)
  config.py            Env var loading
  logging_config.py    structlog JSON logging setup
  metrics.py            Prometheus metric definitions
  tracing.py            OpenTelemetry SDK setup + Kafka header carrier (extract-side only)
```

## Tracing

This service participates in the end-to-end checkout trace (Phase 4) as a pure Kafka
consumer — it never produces events, so it only implements the *extract* half of Kafka
trace-context propagation.

- On startup, `app/tracing.py` registers a `TracerProvider` with an OTLP/HTTP exporter
  (`opentelemetry-exporter-otlp-proto-http`), sending spans to `OTEL_EXPORTER_OTLP_ENDPOINT`
  (default `http://localhost:4318`). Service name comes from `OTEL_SERVICE_NAME` (default
  `notification-service`). Both are standard OTel env vars, read by the SDK/exporter
  automatically.
- Sampling is always-on (100%) — a deliberate simplification for this low-traffic practice
  app, not something you'd run at 100% in a production system.
- On every consumed message (`order.confirmed`, `order.cancelled`), the service reads the
  `traceparent` header (written by the Order service when it publishes, per
  `shared/CONTRACTS.md`'s Kafka propagation contract) using a small `Getter` adapter around
  aiokafka's `ConsumerRecord.headers`, and uses W3C Trace Context (the OTel SDK's default
  propagator — `opentelemetry.propagate.extract`) to resolve the parent trace context. A span
  named `<topic> process` (e.g. `order.confirmed process`) is started as a child of that
  context, so the mock email-sent event shows up as a leaf of the original checkout trace
  instead of a disconnected new trace. The mock "email sent" action is recorded as a span
  event (`template`, `orderId`, `to`) on that span.
- No FastAPI auto-instrumentation is installed — this service's HTTP surface is just
  health/metrics, not worth instrumenting, per `shared/CONTRACTS.md`.
- If the OTLP endpoint is unreachable, span export fails silently in the background
  (`BatchSpanProcessor` on its own thread) — this never blocks or crashes message
  processing or the HTTP server.

## Trust boundary

Not applicable in the usual sense — this service has no REST API called by other
services (Kafka-only), so there's no `X-User-Id` trust boundary here. The only
"boundary" is network access to the Kafka brokers, which is out of scope for this
service (network policy / broker ACLs are a later k8s/infra concern).

## Manually verifying against a local Kafka broker

If you want to see this service react to real events without the rest of the saga
running, publish messages onto `order.confirmed` / `order.cancelled` yourself using the
envelope from `shared/CONTRACTS.md`:

```json
{
  "eventId": "5c1f7e2e-2222-4444-8888-000000000001",
  "eventType": "order.confirmed",
  "orderId": "5c1f7e2e-1111-4444-8888-000000000001",
  "occurredAt": "2026-07-11T10:00:00.000Z",
  "data": { "totalAmount": 42.5 }
}
```

Partition key should be the `orderId` string, matching every other producer/consumer
in the saga.
