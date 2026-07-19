# Payment Service

Phase 2 checkout-saga participant. Python + FastAPI, PostgreSQL, Kafka (`aiokafka`).
This service has **no REST API called by other services** -- it only reacts to Kafka
events. The HTTP surface that exists is purely for operational visibility
(`/healthz`, `/readyz`, `/metrics`) plus one optional debug endpoint.

See `/shared/CONTRACTS.md` for the full saga spec. Summary of this service's role:

```
Payment consumes inventory.reserved
  -> simulate processing delay (PAYMENT_LATENCY_MS_MIN..MAX)
  -> simulate failure (PAYMENT_FAILURE_RATE probability, default 0.1)
  -> success -> insert payments row (status=completed), publish payment.completed
  -> failure -> insert payments row (status=failed, reason="card declined"),
                publish payment.failed
```

## Trust boundary

Not applicable in the usual sense -- this service has no public HTTP endpoints
reachable through the gateway. Its only inbound surface is Kafka (consumer group
`payment-service`) and its own health/metrics endpoints. Postgres and the Kafka
brokers should not be reachable from outside the cluster network (same NetworkPolicy
TODO called out for the other Phase 2 services).

## Design note: where does `amount` come from?

`inventory.reserved` (the only saga topic Payment is documented to consume) carries
`{items: [{productId, quantity}]}` -- no price information. But `payments.amount`,
`payment.completed.data.amount`, and `payment.failed.data.amount` all require a real
amount.

To fill this gap without inventing new topics or changing any contract field, this
service **also subscribes to `order.created`** (already produced by Order, in the
same consumer group `payment-service`) purely to cache `totalAmount` per `orderId`
in a local table (`order_amounts`, not part of the CONTRACTS.md schema -- an internal
implementation detail of this service only). When `inventory.reserved` arrives for
an order, Payment looks up the cached total and uses it as `amount`. If the cache
entry hasn't landed yet (a theoretical race across two topics), it retries briefly
(up to ~2.5s) before falling back to `0.0` and logging a warning -- this never blocks
or drops the saga, it only affects the reported dollar amount in a rare race.

This is a read-only, additive use of a topic Order already owns and publishes with a
stable schema; it does not require any change in Order or Inventory and does not
add, rename, or repurpose any topic or field defined in CONTRACTS.md.

## Simulated latency & failure (chaos-testing feature)

This is deliberate, not a bug: every `inventory.reserved` event triggers a random
sleep between `PAYMENT_LATENCY_MS_MIN` and `PAYMENT_LATENCY_MS_MAX` milliseconds
(simulating a real payment processor round-trip), followed by a random failure roll
at `PAYMENT_FAILURE_RATE` probability (default 10%). On failure, a `payments` row is
still written (`status=failed`, `reason="card declined"`) and `payment.failed` is
published so the saga can correctly cancel the order and release inventory. Tune
these env vars to make failures rarer/more common or the delay shorter/longer when
practicing observability against this saga (e.g. crank `PAYMENT_FAILURE_RATE` up to
watch the compensation path, or `PAYMENT_LATENCY_MS_MAX` up to watch the order stay
`pending`/`inventory_reserved` longer in the storefront).

## Idempotency

`payments.order_id` is `UNIQUE`. Every insert uses `INSERT ... ON CONFLICT (order_id)
DO NOTHING`, and the consumer also does a cheap pre-check before doing any work. If a
`payments` row already exists for an `orderId` (e.g. Kafka redelivered the same
`inventory.reserved` event), the handler logs `payment_already_processed_skipping`
and returns without re-publishing anything -- safe under Kafka's at-least-once
delivery.

## Running locally

Requires a reachable **PostgreSQL** and **Kafka** (this repo's owner runs these by
hand, e.g. via Docker, per service -- no `docker-compose.yml` is provided here on
purpose).

```bash
cd services/payment
cp .env.example .env   # edit DATABASE_URL / KAFKA_BROKERS if needed
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-4005}"
```

On startup the service:
1. Connects to Postgres and creates the `payments` table (and the internal
   `order_amounts` cache table) if they don't already exist.
2. Idempotently creates the `payment.completed` and `payment.failed` topics via the
   Kafka admin client (retries with backoff if the broker isn't up yet, rather than
   crashing).
3. Starts a Kafka producer.
4. Starts a background `asyncio` task running the consumer loop (group
   `payment-service`, subscribed to `inventory.reserved` and `order.created`) --
   this runs alongside the HTTP server, not blocking it.

### Docker

```bash
cd services/payment
docker build -t payment-service .
docker run --rm -p 4005:4005 \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/payment \
  -e KAFKA_BROKERS=host.docker.internal:9092 \
  payment-service
```

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `PORT` | `4005` | HTTP port |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/payment` | Postgres connection string |
| `KAFKA_BROKERS` | `localhost:9092` | Comma-separated broker list |
| `PAYMENT_FAILURE_RATE` | `0.1` | Probability (0.0-1.0) a payment is simulated to fail |
| `PAYMENT_LATENCY_MS_MIN` | `200` | Minimum simulated processing delay (ms) |
| `PAYMENT_LATENCY_MS_MAX` | `1500` | Maximum simulated processing delay (ms) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Standard OTel env var, read automatically by the SDK. Where spans are exported (OTLP/HTTP) |
| `OTEL_SERVICE_NAME` | `payment-service` | Standard OTel env var, read automatically by the SDK. Service name as it appears in traces |

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | Liveness, no dependency checks. `200 {"status":"ok"}` |
| GET | `/readyz` | Checks Postgres + Kafka (producer connected, consumer running). `200 {"status":"ready"}` or `503 {"status":"not-ready","reason":"..."}` |
| GET | `/metrics` | Prometheus exposition format |
| GET | `/payments/{orderId}` | Debug only, not called by any other service. `200 {status, amount, reason}` or `404` |

## Kafka

- Consumer group: `payment-service`
- Consumes: `inventory.reserved` (drives the saga step), `order.created` (amount cache only, see above)
- Produces: `payment.completed`, `payment.failed` (topics created on startup by this service)
- Envelope, partition key, and logging follow CONTRACTS.md's Kafka conventions exactly (`eventId`, `eventType`, `orderId`, `occurredAt`, `data`; key = `orderId`).

## Logs

Structured JSON to stdout via `structlog`: one JSON object per line with
`timestamp`, `level`, `service`, `event` (message), plus context fields
(`orderId`, `eventId`, `eventType`, etc. where relevant). No `print()`.

## Tracing

Phase 4 adds OpenTelemetry distributed tracing, per `/shared/CONTRACTS.md`'s "Phase 4:
distributed tracing" section, so a checkout request can be followed end-to-end across
Gateway -> Order -> Kafka -> Inventory -> Kafka -> **Payment** -> Kafka -> Order -> Kafka
-> Notification as a single trace.

- **Exporter**: OTLP over HTTP (`opentelemetry-exporter-otlp-proto-http`), sent to
  `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4318`). This and
  `OTEL_SERVICE_NAME` are standard OTel env vars, read automatically by the SDK --
  `app/tracing.py` only sets a `payment-service` default for `OTEL_SERVICE_NAME` if it
  isn't already set, it doesn't otherwise touch either var.
- **HTTP spans**: `opentelemetry-instrumentation-fastapi`'s `FastAPIInstrumentor` wraps
  the app in `main.py`, giving server spans (with automatic `traceparent` extraction)
  for `/healthz`, `/readyz`, `/metrics`, and the debug `GET /payments/{orderId}`
  endpoint, with no manual span code.
- **Kafka spans (manual)**: aiokafka has no auto-instrumentation, so trace context is
  carried manually via a `traceparent` Kafka message header (W3C format, e.g.
  `00-<trace-id>-<span-id>-01`) -- never inside the JSON envelope/`data` payload.
  `app/otel_kafka.py` adapts aiokafka's native `List[Tuple[str, bytes]]` header shape to
  OTel's `Getter`/`Setter` protocol so `opentelemetry.propagate.inject()`/`.extract()`
  can read/write it directly (the standard W3C Trace Context propagator underneath --
  nothing hand-rolled).
  - **Consume** (`inventory.reserved`, `order.created`): `app/kafka_consumer.py`
    extracts the `traceparent` header before processing and starts a
    `<topic> process` span as a child of that extracted context.
  - **Publish** (`payment.completed`, `payment.failed`): `app/kafka_producer.py` starts
    a `<topic> publish` span and injects its context into the outgoing message's
    `traceparent` header. This span is parented under the SAME context that was
    extracted from the triggering `inventory.reserved` message -- explicitly passed
    through from the consumer to `publish_event()`, not a fresh/ambient context -- so
    the whole consume -> process -> publish chain stays on one trace.
- **Sampling: 100% (always-on)**. This is a **deliberate practice-app simplification**,
  not a production default -- the SDK's default sampler already does this, and at this
  app's traffic volume there's no cost/volume reason to sample down. A real production
  service would sample well below 100%.
- **Propagation format**: W3C Trace Context, via the OTel SDK's default global
  propagator -- not a custom scheme, which is what lets a trace started in the Go Order
  service continue correctly through this Python service.
- **Failure handling**: if the OTLP endpoint is unreachable, spans are dropped (logged
  as a warning by the exporter/`BatchSpanProcessor`) -- this never blocks or crashes
  request handling or Kafka processing.
- **Local verification without a full backend**: set `OTEL_CONSOLE_EXPORTER=true` (not
  a CONTRACTS.md-required var, just a debug convenience wired into `app/tracing.py`) to
  additionally print every span to stdout as it's created -- useful for confirming span
  names/attributes/trace IDs by eye without standing up Jaeger/Tempo.
