"""Structured JSON logging setup (structlog), per shared/CONTRACTS.md.

Every log line is one JSON object on stdout with `timestamp`, `level`,
`service`, `message`, plus whatever context fields the call site binds.

Note: structlog's default event key is called "event" internally, which
collides with the mock-email log's own `event` field (e.g. "email_sent").
EventRenamer moves the log call's message text to a `message` key instead,
freeing up `event` for our own payload field.
"""
import logging
import sys

import structlog


def _promote_email_event_field(logger, method_name, event_dict):
    """Rename the `emailEvent` context kwarg to `event` in the rendered JSON.

    Call sites can't pass `event=...` directly as a kwarg to a structlog log
    method — the method's own positional parameter is named `event` (that's
    the log message text), so `logger.info("msg", event="email_sent")` raises
    "got multiple values for argument 'event'". Call sites use `emailEvent`
    instead, and this processor renames it to the `event` field required by
    the mock email-sent log schema in shared/CONTRACTS.md.
    """
    if "emailEvent" in event_dict:
        event_dict["event"] = event_dict.pop("emailEvent")
    return event_dict


def configure_logging(service_name: str, log_level: str = "info") -> structlog.stdlib.BoundLogger:
    level = getattr(logging, log_level.upper(), logging.INFO)
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", key="timestamp"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.EventRenamer("message"),
            _promote_email_event_field,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    return structlog.get_logger().bind(service=service_name)
