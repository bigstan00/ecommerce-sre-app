"""Background Kafka consumer for the Notification service.

Subscribes to `order.confirmed` and `order.cancelled` (owned/produced by the
Order service — this service does NOT create these topics, per
shared/CONTRACTS.md) under consumer group `notification-service`, and logs a
mock "email sent" line for each. No real email provider, no outbound HTTP
calls — this is intentionally the simplest consumer in the checkout saga.
"""
import asyncio
import json

import structlog
from aiokafka import AIOKafkaConsumer
from opentelemetry import propagate
from opentelemetry.trace import Status, StatusCode

from app import metrics
from app.tracing import get_tracer, kafka_header_getter

logger = structlog.get_logger()
tracer = get_tracer()

TOPICS = ("order.confirmed", "order.cancelled")
CONSUMER_GROUP = "notification-service"
MOCK_RECIPIENT = "mock@example.com"

TEMPLATE_BY_EVENT_TYPE = {
    "order.confirmed": "order_confirmation",
    "order.cancelled": "order_cancellation",
}

INITIAL_BACKOFF_SECONDS = 1
MAX_BACKOFF_SECONDS = 30


class NotificationConsumer:
    """Owns the lifecycle of the background Kafka consumer task.

    `connected` reflects live Kafka connectivity and backs /readyz — this
    service has no database, so Kafka is the only dependency to check.
    """

    def __init__(self, kafka_brokers: str) -> None:
        self._kafka_brokers = kafka_brokers
        self._consumer: AIOKafkaConsumer | None = None
        self._task: asyncio.Task | None = None
        self.connected = False

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="kafka-consumer")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._consumer is not None:
            await self._consumer.stop()
            self._consumer = None
        self.connected = False

    async def _run(self) -> None:
        backoff = INITIAL_BACKOFF_SECONDS
        while True:
            try:
                self._consumer = AIOKafkaConsumer(
                    *TOPICS,
                    bootstrap_servers=self._kafka_brokers,
                    group_id=CONSUMER_GROUP,
                    enable_auto_commit=True,
                    auto_offset_reset="earliest",
                )
                await self._consumer.start()
                self.connected = True
                backoff = INITIAL_BACKOFF_SECONDS
                logger.info(
                    "kafka_consumer_started",
                    topics=list(TOPICS),
                    groupId=CONSUMER_GROUP,
                    brokers=self._kafka_brokers,
                )
                try:
                    async for message in self._consumer:
                        try:
                            await self._handle_message(message)
                        except Exception as exc:  # noqa: BLE001 - never let one bad message kill the loop
                            metrics.KAFKA_CONSUMER_ERRORS_TOTAL.inc()
                            logger.error(
                                "kafka_message_handling_error",
                                topic=message.topic,
                                error=str(exc),
                            )
                finally:
                    self.connected = False
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - broker down / connection lost, retry with backoff
                self.connected = False
                metrics.KAFKA_CONSUMER_ERRORS_TOTAL.inc()
                logger.error(
                    "kafka_consumer_error",
                    error=str(exc),
                    retryInSeconds=backoff,
                )
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
            finally:
                if self._consumer is not None:
                    try:
                        await self._consumer.stop()
                    except Exception:  # noqa: BLE001 - best-effort cleanup before retrying
                        pass
                    self._consumer = None

    async def _handle_message(self, message) -> None:
        topic = message.topic

        # Extract the `traceparent` header (written by the Order service on
        # produce) BEFORE any processing, and use it as the parent context
        # for this message's span — this is what makes this consumer's work
        # show up as part of the original checkout trace instead of a new
        # root trace. See shared/CONTRACTS.md's "Kafka propagation" section.
        parent_ctx = propagate.extract(message.headers, getter=kafka_header_getter)

        with tracer.start_as_current_span(f"{topic} process", context=parent_ctx) as span:
            span.set_attribute("messaging.system", "kafka")
            span.set_attribute("messaging.destination.name", topic)
            span.set_attribute("messaging.operation", "process")

            try:
                envelope = json.loads(message.value.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                metrics.KAFKA_CONSUMER_ERRORS_TOTAL.inc()
                logger.error("kafka_message_parse_error", topic=topic, error=str(exc))
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR, "message parse error"))
                return

            event_id = envelope.get("eventId")
            event_type = envelope.get("eventType")
            order_id = envelope.get("orderId")

            if event_id:
                span.set_attribute("messaging.message.id", event_id)
            if order_id:
                span.set_attribute("orderId", order_id)
            if event_type:
                span.set_attribute("eventType", event_type)

            logger.info(
                "kafka_event_consumed",
                eventId=event_id,
                eventType=event_type,
                orderId=order_id,
                topic=topic,
            )
            metrics.KAFKA_EVENTS_CONSUMED_TOTAL.labels(
                topic=topic, event_type=event_type or "unknown"
            ).inc()

            template = TEMPLATE_BY_EVENT_TYPE.get(event_type)
            if template is None:
                logger.warning(
                    "unknown_event_type",
                    eventType=event_type,
                    topic=topic,
                    orderId=order_id,
                )
                span.add_event("unknown_event_type", {"eventType": event_type or ""})
                return

            # Mock "email send" — no real provider, no outbound HTTP call.
            # `emailEvent` (not `event`) here — see logging_config._promote_email_event_field
            # for why: structlog's log methods already have a positional `event` param.
            logger.info(
                "mock_email_sent",
                emailEvent="email_sent",
                template=template,
                orderId=order_id,
                to=MOCK_RECIPIENT,
            )
            metrics.MOCK_EMAILS_SENT_TOTAL.labels(template=template).inc()

            # Record the mock email send as a span event, within the same
            # span/trace as the original checkout request — this is the
            # "notification" leaf of the end-to-end saga trace.
            span.add_event(
                "email_sent",
                {
                    "template": template,
                    "orderId": order_id or "",
                    "to": MOCK_RECIPIENT,
                },
            )
