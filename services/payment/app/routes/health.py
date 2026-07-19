"""Health, readiness, and metrics endpoints -- cross-cutting convention for every
service per CONTRACTS.md."""
from __future__ import annotations

from fastapi import APIRouter, Response

from app import db, kafka_consumer
from app.kafka_producer import get_producer
from app.metrics import render_metrics

router = APIRouter()


@router.get("/healthz")
async def healthz():
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(response: Response):
    db_ok = await db.check_db_connectivity()

    kafka_ok = False
    try:
        producer = get_producer()
        node_id = producer.client.get_random_node()
        kafka_ok = node_id is not None and await producer.client.ready(node_id)
    except Exception:
        kafka_ok = False

    consumer_ok = kafka_consumer.is_ready()

    if db_ok and kafka_ok and consumer_ok:
        return {"status": "ready"}

    reasons = []
    if not db_ok:
        reasons.append("postgres unreachable")
    if not kafka_ok:
        reasons.append("kafka producer not connected")
    if not consumer_ok:
        reasons.append("kafka consumer not ready")

    response.status_code = 503
    return {"status": "not-ready", "reason": "; ".join(reasons)}


@router.get("/metrics")
async def metrics():
    body, content_type = render_metrics()
    return Response(content=body, media_type=content_type)
