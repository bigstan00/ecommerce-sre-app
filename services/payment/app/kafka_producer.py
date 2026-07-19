"""Kafka producer + idempotent topic creation for the Payment service.

Per CONTRACTS.md Kafka conventions: Payment produces `payment.completed` and
`payment.failed`, so it owns creating those topics on startup (idempotent, via the
admin client, with retry/backoff if the broker isn't up yet -- never crash on this).
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone

from aiokafka import AIOKafkaProducer
from aiokafka.admin import AIOKafkaAdminClient, NewTopic
from aiokafka.errors import TopicAlreadyExistsError, KafkaConnectionError, KafkaError
from opentelemetry import propagate, trace
from opentelemetry.context import Context
from opentelemetry.trace import SpanKind

from app.config import settings
from app.logging_config import get_logger
from app.metrics import KAFKA_EVENTS_PRODUCED_TOTAL
from app.otel_kafka import KafkaHeaders, kafka_header_setter

logger = get_logger(component="kafka_producer")
tracer = trace.get_tracer(__name__)

OWNED_TOPICS = ["payment.completed", "payment.failed"]

_producer: AIOKafkaProducer | None = None


def _json_serializer(value: dict) -> bytes:
    return json.dumps(value).encode("utf-8")


async def create_owned_topics(max_retries: int = 10, base_delay_seconds: float = 2.0) -> None:
    """Idempotently create the topics this service produces to, retrying with
    backoff if the broker isn't reachable yet rather than crashing on startup."""
    attempt = 0
    while True:
        admin = AIOKafkaAdminClient(bootstrap_servers=settings.kafka_bootstrap_servers)
        try:
            await admin.start()
            new_topics = [
                NewTopic(name=topic, num_partitions=3, replication_factor=1)
                for topic in OWNED_TOPICS
            ]
            try:
                await admin.create_topics(new_topics)
                logger.info("kafka_topics_created", topics=OWNED_TOPICS)
            except TopicAlreadyExistsError:
                logger.info("kafka_topics_already_exist", topics=OWNED_TOPICS)
            return
        except (KafkaConnectionError, KafkaError, OSError) as exc:
            attempt += 1
            if attempt > max_retries:
                logger.error(
                    "kafka_topic_creation_failed_giving_up",
                    error=str(exc),
                    attempts=attempt,
                )
                raise
            delay = base_delay_seconds * attempt
            logger.warning(
                "kafka_topic_creation_retry",
                error=str(exc),
                attempt=attempt,
                retry_in_seconds=delay,
            )
            await asyncio.sleep(delay)
        finally:
            try:
                await admin.close()
            except Exception:
                pass


async def start_producer() -> AIOKafkaProducer:
    global _producer
    if _producer is None:
        _producer = AIOKafkaProducer(
            bootstrap_servers=settings.kafka_bootstrap_servers,
            value_serializer=_json_serializer,
            key_serializer=lambda k: k.encode("utf-8") if isinstance(k, str) else k,
        )
        await _producer.start()
        logger.info("kafka_producer_started")
    return _producer


async def stop_producer() -> None:
    global _producer
    if _producer is not None:
        await _producer.stop()
        _producer = None
        logger.info("kafka_producer_stopped")


def get_producer() -> AIOKafkaProducer:
    if _producer is None:
        raise RuntimeError("Kafka producer not started -- call start_producer() first")
    return _producer


def _iso_millis_now() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


async def publish_event(
    topic: str,
    event_type: str,
    order_id: str,
    data: dict,
    parent_context: Context | None = None,
) -> dict:
    """Build the CONTRACTS.md envelope and publish it, keyed by orderId.

    `parent_context`: the OTel context to parent the publish span under. Per
    CONTRACTS.md, for payment.completed/payment.failed this must be the SAME context
    that was extracted when the triggering `inventory.reserved` message was consumed
    (passed explicitly by kafka_consumer.py) -- NOT a fresh/ambient context -- so the
    published event's `traceparent` header continues that same trace rather than
    starting a new one. If omitted, falls back to whatever context is currently
    active (e.g. for ad-hoc/test publishes).
    """
    envelope = {
        "eventId": str(uuid.uuid4()),
        "eventType": event_type,
        "orderId": order_id,
        "occurredAt": _iso_millis_now(),
        "data": data,
    }

    headers: KafkaHeaders = []
    with tracer.start_as_current_span(
        f"{topic} publish",
        context=parent_context,
        kind=SpanKind.PRODUCER,
        attributes={
            "messaging.system": "kafka",
            "messaging.destination.name": topic,
            "messaging.operation": "publish",
            "orderId": order_id,
        },
    ):
        # Inject into the carrier using the context now active (i.e. including the
        # "<topic> publish" span just started above), so the traceparent header
        # written to Kafka points at this span as the consumer's parent.
        propagate.inject(headers, setter=kafka_header_setter)

        producer = get_producer()
        await producer.send_and_wait(topic, value=envelope, key=order_id, headers=headers)

    KAFKA_EVENTS_PRODUCED_TOTAL.labels(topic=topic, event_type=event_type).inc()
    logger.info(
        "kafka_event_produced",
        eventId=envelope["eventId"],
        eventType=event_type,
        orderId=order_id,
        topic=topic,
    )
    return envelope
