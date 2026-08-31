# aiobs: business-event recorder (auto-added). Emits one structured JSON
# line per event to stdout — ingested by any log pipeline. Swap the body
# to forward to your telemetry SDK (e.g. OpenTelemetry) if you prefer.
def track(event, attributes=None):
    import json as _json, sys as _sys, datetime as _dt
    try:
        _sys.stdout.write(_json.dumps({"ts": _dt.datetime.utcnow().isoformat(), "event": event, **(attributes or {})}) + "\n")
    except Exception:
        pass  # never let telemetry throw

"""Background Kafka consumer for the Payment service.

Consumer group `payment-service`, per CONTRACTS.md Kafka conventions.

Primary responsibility: consume `inventory.reserved` and run the simulated payment
processing step of the checkout saga (latency + random failure), then publish
`payment.completed` or `payment.failed`.

Secondary responsibility: also consume `order.created` -- not part of the saga state
machine, just an internal cache lookup so the `amount` field on `payments` /
`payment.completed` / `payment.failed` reflects the real order total. See the
module docstring in db.py for the full rationale; this is a read-only subscription
to a topic Order already produces, using its documented schema exactly, and does not
add any new topic or change any contract field.

Idempotency: guarded by the unique constraint on payments.order_id (see db.py). If a
payments row already exists for an orderId, the event is logged and skipped -- this
makes the handler safe against Kafka's at-least-once redelivery.
"""
from __future__ import annotations

import asyncio
import random

from aiokafka import AIOKafkaConsumer
from aiokafka.errors import KafkaConnectionError, KafkaError
from opentelemetry import context as context_api
from opentelemetry import propagate, trace
from opentelemetry.context import Context
from opentelemetry.trace import SpanKind

from app import db
from app.config import settings
from app.kafka_producer import publish_event
from app.logging_config import get_logger
from app.metrics import KAFKA_EVENTS_CONSUMED_TOTAL, PAYMENTS_PROCESSED_TOTAL
from app.otel_kafka import kafka_header_getter

logger = get_logger(component="kafka_consumer")
tracer = trace.get_tracer(__name__)

CONSUMER_GROUP_ID = "payment-service"
CONSUMED_TOPICS = ["inventory.reserved", "order.created"]

PAYMENT_FAILURE_REASON = "card declined"

# How long to wait (and how many times to retry) for the order.created amount cache
# to be populated, in case inventory.reserved is processed by this service before its
# own order.created consumption catches up. The simulated processing delay below
# already gives ample buffer in practice.
_AMOUNT_CACHE_RETRY_ATTEMPTS = 5
_AMOUNT_CACHE_RETRY_DELAY_SECONDS = 0.5

_consumer: AIOKafkaConsumer | None = None
_consumer_task: asyncio.Task | None = None
_ready = asyncio.Event()


def is_ready() -> bool:
    return _ready.is_set()


async def _connect_consumer(max_retries: int = 10, base_delay_seconds: float = 2.0) -> AIOKafkaConsumer:
    attempt = 0
    while True:
        consumer = AIOKafkaConsumer(
            *CONSUMED_TOPICS,
            bootstrap_servers=settings.kafka_bootstrap_servers,
            group_id=CONSUMER_GROUP_ID,
            enable_auto_commit=True,
            auto_offset_reset="earliest",
            value_deserializer=lambda v: v,
        )
        try:
            await consumer.start()
            return consumer
        except (KafkaConnectionError, KafkaError, OSError) as exc:
            attempt += 1
            await consumer.stop()
            if attempt > max_retries:
                logger.error(
                    "kafka_consumer_connect_failed_giving_up",
                    error=str(exc),
                    attempts=attempt,
                )
                raise
            delay = base_delay_seconds * attempt
            logger.warning(
                "kafka_consumer_connect_retry",
                error=str(exc),
                attempt=attempt,
                retry_in_seconds=delay,
            )
            await asyncio.sleep(delay)


def _decode_envelope(raw_value: bytes) -> dict | None:
    import json

    try:
        return json.loads(raw_value.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.warning("kafka_message_decode_failed")
        return None


async def _handle_order_created(envelope: dict) -> None:
    order_id = envelope.get("orderId")
    data = envelope.get("data") or {}
    total_amount = data.get("totalAmount")

    KAFKA_EVENTS_CONSUMED_TOTAL.labels(topic="order.created", event_type="order.created").inc()
    logger.info(
        "kafka_event_consumed",
        eventId=envelope.get("eventId"),
        eventType="order.created",
        orderId=order_id,
    )

    if order_id is None or total_amount is None:
        logger.warning("order_created_missing_fields", orderId=order_id)
        return

track('order.amount.cached', {'order_id': order_id, 'amount': total_amount})
    await db.cache_order_amount(order_id, float(total_amount))


async def _resolve_amount(order_id: str) -> float:
    for attempt in range(_AMOUNT_CACHE_RETRY_ATTEMPTS):
        amount = await db.get_cached_order_amount(order_id)
        if amount is not None:
            return amount
        await asyncio.sleep(_AMOUNT_CACHE_RETRY_DELAY_SECONDS)

    logger.warning(
        "order_amount_not_found_in_cache_falling_back",
        orderId=order_id,
        fallback_amount=0.0,
    )
    return 0.0


async def _handle_inventory_reserved(envelope: dict, trace_context: Context) -> None:
    order_id = envelope.get("orderId")

    KAFKA_EVENTS_CONSUMED_TOTAL.labels(
        topic="inventory.reserved", event_type="inventory.reserved"
    ).inc()
    logger.info(
        "kafka_event_consumed",
        eventId=envelope.get("eventId"),
        eventType="inventory.reserved",
        orderId=order_id,
    )

    if order_id is None:
        logger.warning("inventory_reserved_missing_order_id")
        return

    if await db.payment_exists(order_id):
        logger.info("payment_already_processed_skipping", orderId=order_id)
        return

    amount = await _resolve_amount(order_id)

    latency_ms = random.randint(
        settings.payment_latency_ms_min, settings.payment_latency_ms_max
    )
    await asyncio.sleep(latency_ms / 1000.0)

    should_fail = random.random() < settings.payment_failure_rate

    if should_fail:
        row = await db.insert_payment(
            order_id=order_id, amount=amount, status="failed", reason=PAYMENT_FAILURE_REASON
        )
        if row is None:
            logger.info("payment_already_processed_skipping_post_delay", orderId=order_id)
            return
        PAYMENTS_PROCESSED_TOTAL.labels(outcome="failed").inc()
        track('payment.failed', {'order_id': order_id, 'amount': amount, 'reason': PAYMENT_FAILURE_REASON})
        await publish_event(
            topic="payment.failed",
            event_type="payment.failed",
            order_id=order_id,
            data={"reason": PAYMENT_FAILURE_REASON, "amount": amount},
            parent_context=trace_context,
        )
        logger.info(
            "payment_failed_simulated",
            orderId=order_id,
            amount=amount,
            reason=PAYMENT_FAILURE_REASON,
            latencyMs=latency_ms,
        )
    else:
        row = await db.insert_payment(
            order_id=order_id, amount=amount, status="completed", reason=None
        )
        if row is None:
            logger.info("payment_already_processed_skipping_post_delay", orderId=order_id)
            return
        PAYMENTS_PROCESSED_TOTAL.labels(outcome="completed").inc()
        track('payment.completed', {'order_id': order_id, 'amount': amount})
        await publish_event(
            topic="payment.completed",
            event_type="payment.completed",
            order_id=order_id,
            data={"paymentId": str(row["id"]), "amount": amount},
            parent_context=trace_context,
        )
        logger.info(
            "payment_completed",
            orderId=order_id,
            amount=amount,
            paymentId=str(row["id"]),
            latencyMs=latency_ms,
        )


async def _consume_loop(consumer: AIOKafkaConsumer) -> None:
    async for message in consumer:
        envelope = _decode_envelope(message.value)
        if envelope is None:
            continue

        # Extract the traceparent header the producer (Inventory for
        # inventory.reserved, Order for order.created) injected, and use it as the
        # parent for this message's processing span -- this is what continues the
        # SAME trace across the Kafka hop instead of starting a disconnected one.
        # Per CONTRACTS.md: context rides purely in Kafka's native headers, never in
        # the JSON envelope/data payload.
        extracted_context = propagate.extract(message.headers or [], getter=kafka_header_getter)

        try:
            with tracer.start_as_current_span(
                f"{message.topic} process",
                context=extracted_context,
                kind=SpanKind.CONSUMER,
                attributes={
                    "messaging.system": "kafka",
                    "messaging.destination.name": message.topic,
                    "messaging.operation": "process",
                    "orderId": envelope.get("orderId") or "",
                },
            ):
                # The context now active includes the "<topic> process" span just
                # started above (child of extracted_context). Capture it so
                # _handle_inventory_reserved can pass it through, unchanged, as the
                # parent for whatever it publishes in response -- per CONTRACTS.md,
                # payment.completed/payment.failed must derive from THIS same
                # context, not a fresh one.
                process_context = context_api.get_current()

                if message.topic == "order.created":
                    await _handle_order_created(envelope)
                elif message.topic == "inventory.reserved":
                    await _handle_inventory_reserved(envelope, process_context)
        except Exception:
            logger.error(
                "kafka_message_handling_error",
                topic=message.topic,
                orderId=envelope.get("orderId"),
                exc_info=True,
            )


async def start_consumer() -> None:
    global _consumer, _consumer_task
    _consumer = await _connect_consumer()
    logger.info(
        "kafka_consumer_started", topics=CONSUMED_TOPICS, group_id=CONSUMER_GROUP_ID
    )
    _ready.set()
    _consumer_task = asyncio.current_task()
    try:
        await _consume_loop(_consumer)
    finally:
        _ready.clear()


async def stop_consumer() -> None:
    global _consumer
    _ready.clear()
    if _consumer is not None:
        await _consumer.stop()
        _consumer = None
        logger.info("kafka_consumer_stopped")
