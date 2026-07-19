"""OpenTelemetry SDK setup for the Payment service (Phase 4).

Per CONTRACTS.md's "Phase 4: distributed tracing" section:
  - Exporter protocol: OTLP over HTTP (`opentelemetry-exporter-otlp-proto-http`).
  - Endpoint: standard env var `OTEL_EXPORTER_OTLP_ENDPOINT`, default
    `http://localhost:4318`. The exporter class reads this env var itself when no
    `endpoint=` kwarg is passed (verified against the installed SDK: `OTLPSpanExporter()`
    falls back to `environ[OTEL_EXPORTER_OTLP_ENDPOINT]` or `http://localhost:4318/` and
    appends `/v1/traces`) -- we do NOT need to read/parse this var ourselves.
  - Service name: standard env var `OTEL_SERVICE_NAME`. `Resource.create()` also reads
    this itself, but its own built-in fallback is `unknown_service`, not our desired
    per-service default. So we `setdefault` the env var to `payment-service` *before*
    calling `Resource.create()`, which both (a) respects an operator-supplied
    `OTEL_SERVICE_NAME` and (b) gives us the right default when unset -- rather than
    passing an explicit `{"service.name": ...}` attribute, which would unconditionally
    override the env var even when one was supplied (confirmed via a quick throwaway
    script against opentelemetry-sdk 1.43.0: `Resource.create({SERVICE_NAME: "x"})`
    always wins over `OTEL_SERVICE_NAME`, so setdefault-then-create is the only way to
    get "env var wins if set, else our default").
  - Sampling: always-on (100%) -- this SDK's default `Sampler` (`ParentBased(ALWAYS_ON)`)
    already does this, no explicit sampler config needed. Documented as a deliberate
    practice-app simplification in README.md.
  - Propagation: W3C Trace Context, via the OTel API's default global propagator
    (`opentelemetry.propagate`) -- also already the SDK default when no
    `OTEL_PROPAGATORS` env var is set, nothing to configure here.
  - If the OTLP endpoint is unreachable, spans must be dropped/logged as a warning, never
    block or crash the service. This is inherent behavior of `BatchSpanProcessor` (runs
    export in a background thread) and `OTLPSpanExporter` (catches request exceptions in
    `export()` and returns `SpanExportResult.FAILURE` instead of raising) -- no extra
    handling required here.

Must be called as early as possible in the entrypoint (see main.py), before importing
anything that should be auto-instrumented (FastAPI), mirroring the existing
`configure_logging()` early-import pattern in main.py.
"""
from __future__ import annotations

import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

DEFAULT_SERVICE_NAME = "payment-service"

_configured = False


def configure_tracing() -> None:
    """Initialize the global TracerProvider with an OTLP/HTTP exporter.

    Idempotent -- safe to call more than once (e.g. under a test harness that
    re-imports the app), only the first call takes effect.
    """
    global _configured
    if _configured:
        return

    os.environ.setdefault("OTEL_SERVICE_NAME", DEFAULT_SERVICE_NAME)

    resource = Resource.create()
    provider = TracerProvider(resource=resource)

    # OTLPSpanExporter() with no endpoint kwarg reads OTEL_EXPORTER_OTLP_ENDPOINT
    # itself (default http://localhost:4318, per CONTRACTS.md) -- verified above.
    otlp_exporter = OTLPSpanExporter()
    provider.add_span_processor(BatchSpanProcessor(otlp_exporter))

    # Optional, off by default: a console exporter for local verification, per
    # CONTRACTS.md's "wire up (at least temporarily, for your own verification) a
    # console span exporter" instruction. Not part of the required contract env
    # vars -- purely a debugging aid so spans are visible without a running
    # collector. Enable with OTEL_CONSOLE_EXPORTER=true.
    if os.getenv("OTEL_CONSOLE_EXPORTER", "").strip().lower() in ("1", "true", "yes"):
        from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor

        provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))

    trace.set_tracer_provider(provider)
    _configured = True


def get_tracer() -> trace.Tracer:
    return trace.get_tracer("payment-service")
