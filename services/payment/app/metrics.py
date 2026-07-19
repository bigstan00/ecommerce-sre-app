"""Prometheus metrics for the Payment service, via prometheus-client."""
from __future__ import annotations

import time
from contextlib import contextmanager

from prometheus_client import Counter, Histogram, CONTENT_TYPE_LATEST, generate_latest

HTTP_REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "path", "status"],
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "path"],
)

HTTP_ERRORS_TOTAL = Counter(
    "http_errors_total",
    "Total HTTP error responses (status >= 500)",
    ["method", "path", "status"],
)

PAYMENTS_PROCESSED_TOTAL = Counter(
    "payments_processed_total",
    "Total payments processed by outcome",
    ["outcome"],  # completed | failed
)

KAFKA_EVENTS_CONSUMED_TOTAL = Counter(
    "kafka_events_consumed_total",
    "Total Kafka events consumed",
    ["topic", "event_type"],
)

KAFKA_EVENTS_PRODUCED_TOTAL = Counter(
    "kafka_events_produced_total",
    "Total Kafka events produced",
    ["topic", "event_type"],
)


@contextmanager
def track_http_request(method: str, path: str):
    start = time.perf_counter()
    try:
        yield
    finally:
        HTTP_REQUEST_DURATION_SECONDS.labels(method=method, path=path).observe(
            time.perf_counter() - start
        )


def render_metrics() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST
