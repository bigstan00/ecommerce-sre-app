"""OpenTelemetry tracing setup for the Notification service.

Per shared/CONTRACTS.md's Phase 4 section:

- Exporter protocol is OTLP over HTTP. `OTLPSpanExporter` (from
  `opentelemetry-exporter-otlp-proto-http`) reads the standard
  `OTEL_EXPORTER_OTLP_ENDPOINT` env var itself (default
  `http://localhost:4318`, with `/v1/traces` appended automatically) — we
  don't need to read/pass it by hand.
- Service name comes from the standard `OTEL_SERVICE_NAME` env var. The SDK's
  `Resource.create()` also reads this automatically via its built-in "otel"
  resource detector, but we read it explicitly too so we can apply this
  service's own default (`notification-service`) when it's unset, per
  CONTRACTS.md's per-service default list.
- Sampling is always-on (100%) — the SDK's `TracerProvider` default sampler
  (`ParentBased(AlwaysOn)`) already does this; no explicit sampler config
  needed. This is a deliberate practice-app simplification, not something
  you'd run at 100% in production.
- Propagation is W3C Trace Context, via the OTel API's default global
  propagator (`opentelemetry.propagate`) — nothing custom.
- If the OTLP endpoint is unreachable, `BatchSpanProcessor` exports off the
  hot path on a background thread; failures are logged by the SDK and the
  batch is dropped. This never blocks or crashes request/message handling.

This service is Kafka-consumer-only (never produces events), so only the
consume-side half of the Kafka trace-context carrier is implemented here: a
`Getter` adapting aiokafka's `ConsumerRecord.headers` (`List[Tuple[str,
bytes]]`) for `opentelemetry.propagate.extract()`. There is no Setter/inject
side in this service.
"""
import os
from typing import List, Optional, Tuple

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.propagators.textmap import Getter
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

DEFAULT_SERVICE_NAME = "notification-service"

TRACER_NAME = "notification-service"


def configure_tracing() -> None:
    """Initialize and register the global TracerProvider.

    Safe to call once at service startup, before the Kafka consumer starts
    handling messages. Never raises on a bad/unreachable OTLP endpoint —
    export failures surface later, asynchronously, from the batch span
    processor's background thread, not from this call.
    """
    service_name = os.getenv("OTEL_SERVICE_NAME", DEFAULT_SERVICE_NAME)
    resource = Resource.create({SERVICE_NAME: service_name})

    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)


def get_tracer() -> trace.Tracer:
    return trace.get_tracer(TRACER_NAME)


def shutdown_tracing() -> None:
    """Flush and shut down the TracerProvider. Best-effort — swallow errors
    so a slow/unreachable collector never blocks service shutdown.
    """
    provider = trace.get_tracer_provider()
    shutdown = getattr(provider, "shutdown", None)
    if shutdown is not None:
        try:
            shutdown()
        except Exception:  # noqa: BLE001 - best-effort cleanup on exit
            pass


class KafkaHeaderGetter(Getter[List[Tuple[str, bytes]]]):
    """Adapts aiokafka's `ConsumerRecord.headers` — a
    `List[Tuple[str, bytes]]` — to OTel's `Getter` protocol, so
    `opentelemetry.propagate.extract()` can pull the `traceparent` header
    back out of a consumed message and use it as the parent context for the
    `<topic> process` span.
    """

    def get(self, carrier: List[Tuple[str, bytes]], key: str) -> Optional[List[str]]:
        if not carrier:
            return None
        for header_key, header_value in carrier:
            if header_key == key and header_value is not None:
                return [header_value.decode("utf-8")]
        return None

    def keys(self, carrier: List[Tuple[str, bytes]]) -> List[str]:
        if not carrier:
            return []
        return [header_key for header_key, _ in carrier]


kafka_header_getter = KafkaHeaderGetter()
