"""Prometheus metrics for the Notification service.

Covers the cross-cutting minimum from shared/CONTRACTS.md (HTTP request
count, request duration histogram, error count) plus a couple of
service-specific counters for the Kafka consumption side, since that's
where almost all of this service's work happens.
"""
from prometheus_client import Counter, Histogram

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
    "Total HTTP responses with status >= 400",
    ["method", "path", "status"],
)

KAFKA_EVENTS_CONSUMED_TOTAL = Counter(
    "kafka_events_consumed_total",
    "Total Kafka events consumed",
    ["topic", "event_type"],
)

KAFKA_CONSUMER_ERRORS_TOTAL = Counter(
    "kafka_consumer_errors_total",
    "Total Kafka consumer errors (connection failures, parse failures, etc.)",
)

MOCK_EMAILS_SENT_TOTAL = Counter(
    "mock_emails_sent_total",
    "Total mock emails logged as sent",
    ["template"],
)
