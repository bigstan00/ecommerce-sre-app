"""OTel trace-context carrier adapter for aiokafka message headers.

Per CONTRACTS.md's "Kafka propagation" section: Kafka headers are the only way trace
context survives a producer -> consumer hop (no HTTP request to auto-instrument). Every
service must add exactly one new header, `traceparent` (UTF-8-encoded W3C string,
e.g. `00-<trace-id>-<span-id>-01`), to messages it produces, and read it on every
message it consumes -- context must NOT ride in the JSON envelope/`data` payload.

aiokafka represents headers identically on both sides as `List[Tuple[str, bytes]]`
(`ConsumerRecord.headers` on consume, the `headers=` kwarg to `producer.send()` /
`send_and_wait()` on produce -- confirmed against aiokafka's `ConsumerRecord` dataclass
and `AIOKafkaProducer.send()` signature). This module wraps that list shape in OTel's
`Getter`/`Setter` protocol (`opentelemetry.propagators.textmap`) so
`opentelemetry.propagate.inject()` / `.extract()` can read and write it directly --
this is the SDK's standard W3C Trace Context propagator underneath; we are not
hand-rolling any header format ourselves, only adapting the carrier shape.
"""
from __future__ import annotations

from opentelemetry.propagators.textmap import Getter, Setter

# Matches aiokafka's native header shape on both ConsumerRecord.headers and the
# `headers=` kwarg accepted by AIOKafkaProducer.send()/send_and_wait().
KafkaHeaders = list[tuple[str, bytes]]


class AiokafkaHeaderGetter(Getter[KafkaHeaders]):
    """Reads propagated fields (e.g. `traceparent`) back out of aiokafka headers."""

    def get(self, carrier: KafkaHeaders, key: str) -> list[str] | None:
        if not carrier:
            return None
        values = [value.decode("utf-8") for k, value in carrier if k == key]
        return values or None

    def keys(self, carrier: KafkaHeaders) -> list[str]:
        if not carrier:
            return []
        return [k for k, _ in carrier]


class AiokafkaHeaderSetter(Setter[KafkaHeaders]):
    """Writes propagated fields (e.g. `traceparent`) into aiokafka headers."""

    def set(self, carrier: KafkaHeaders, key: str, value: str) -> None:
        if carrier is None:
            return
        carrier.append((key, value.encode("utf-8")))


# Stateless -- safe to share module-level singletons across all producers/consumers.
kafka_header_getter = AiokafkaHeaderGetter()
kafka_header_setter = AiokafkaHeaderSetter()
