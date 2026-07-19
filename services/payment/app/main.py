"""Payment service entrypoint (FastAPI + aiokafka background consumer).

Starts:
  - a Postgres connection pool + DDL for `payments` (and an internal `order_amounts`
    cache table, see db.py)
  - a Kafka producer, and idempotently creates the topics this service owns
    (`payment.completed`, `payment.failed`)
  - a background asyncio task running the Kafka consumer loop (group
    `payment-service`, subscribed to `inventory.reserved` and `order.created`) --
    this runs alongside the HTTP server, not blocking it.
"""
from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager

# Must run before any other `app.*` import: several modules create module-level
# bound loggers at import time (e.g. `logger = get_logger(component="db")`), and
# structlog resolves the active renderer/processors as soon as a logger is bound,
# not lazily per call. If configure_logging() ran after those imports, the early
# loggers would be bound against structlog's default console renderer instead of
# our JSON config, producing inconsistent (non-JSON) log lines.
from app.logging_config import configure_logging, get_logger

configure_logging()

# Also as early as possible, and before importing FastAPIInstrumentor or creating the
# FastAPI app below: sets the global TracerProvider (OTLP/HTTP exporter) that
# FastAPIInstrumentor.instrument_app() and every manual span in kafka_consumer.py /
# kafka_producer.py attach spans to. Per CONTRACTS.md Phase 4.
from app.tracing import configure_tracing

configure_tracing()

from fastapi import FastAPI, Request
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

from app import db
from app.config import settings
from app.kafka_consumer import start_consumer, stop_consumer
from app.kafka_producer import create_owned_topics, start_producer, stop_producer
from app.metrics import HTTP_ERRORS_TOTAL, HTTP_REQUESTS_TOTAL, HTTP_REQUEST_DURATION_SECONDS
from app.routes import health, payments

logger = get_logger(component="main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("payment_service_starting", port=settings.port)

    await db.init_db_pool()
    await create_owned_topics()
    await start_producer()

    consumer_task = asyncio.create_task(start_consumer(), name="payment-kafka-consumer")

    def _on_consumer_done(task: asyncio.Task) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            logger.error("kafka_consumer_task_crashed", error=str(exc), exc_info=exc)

    consumer_task.add_done_callback(_on_consumer_done)

    logger.info("payment_service_started")
    try:
        yield
    finally:
        logger.info("payment_service_shutting_down")
        consumer_task.cancel()
        try:
            await consumer_task
        except asyncio.CancelledError:
            pass
        await stop_consumer()
        await stop_producer()
        await db.close_db_pool()
        logger.info("payment_service_stopped")


app = FastAPI(title="Payment Service", lifespan=lifespan)

# Auto-instruments this app's routes (health/metrics endpoints, GET /payments/{orderId})
# with server spans, including W3C traceparent extraction from inbound request headers
# -- no manual span code needed for the HTTP side, per CONTRACTS.md.
FastAPIInstrumentor.instrument_app(app)


@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - start

    path = request.url.path
    method = request.method
    status = str(response.status_code)

    HTTP_REQUESTS_TOTAL.labels(method=method, path=path, status=status).inc()
    HTTP_REQUEST_DURATION_SECONDS.labels(method=method, path=path).observe(duration)
    if response.status_code >= 500:
        HTTP_ERRORS_TOTAL.labels(method=method, path=path, status=status).inc()

    return response


app.include_router(health.router)
app.include_router(payments.router)
