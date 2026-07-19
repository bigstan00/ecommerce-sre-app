"""Notification service entrypoint.

Runs a tiny FastAPI app for /healthz, /readyz, /metrics, and starts the
background Kafka consumer (order.confirmed / order.cancelled) alongside it.
This service has almost no HTTP surface by design — it's a Kafka consumer
with health endpoints bolted on, per shared/CONTRACTS.md.
"""
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app import metrics
from app.config import settings
from app.kafka_consumer import NotificationConsumer
from app.logging_config import configure_logging
from app.tracing import configure_tracing, shutdown_tracing

logger = configure_logging(settings.service_name, settings.log_level)

# Initialize the OTel SDK before the Kafka consumer is constructed, so its
# `<topic> process` spans always have a real TracerProvider registered by
# the time the first message is handled. See app/tracing.py for details.
configure_tracing()

consumer = NotificationConsumer(settings.kafka_brokers)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "service_starting",
        port=settings.port,
        kafkaBrokers=settings.kafka_brokers,
    )
    await consumer.start()
    yield
    logger.info("service_stopping")
    await consumer.stop()
    shutdown_tracing()


app = FastAPI(title="Notification Service", lifespan=lifespan)


@app.middleware("http")
async def track_metrics(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - start

    path = request.url.path
    method = request.method
    status = response.status_code

    metrics.HTTP_REQUEST_DURATION_SECONDS.labels(method=method, path=path).observe(duration)
    metrics.HTTP_REQUESTS_TOTAL.labels(method=method, path=path, status=status).inc()
    if status >= 400:
        metrics.HTTP_ERRORS_TOTAL.labels(method=method, path=path, status=status).inc()

    return response


@app.get("/healthz")
async def healthz():
    """Liveness — no dependency checks."""
    return {"status": "ok"}


@app.get("/readyz")
async def readyz():
    """Readiness — this service has no DB, so only Kafka connectivity matters."""
    if consumer.connected:
        return {"status": "ready"}
    return JSONResponse(
        status_code=503,
        content={"status": "not-ready", "reason": "kafka consumer not connected"},
    )


@app.get("/metrics")
async def metrics_endpoint():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port)
