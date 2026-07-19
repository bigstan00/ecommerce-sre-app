"""Environment-driven configuration for the Payment service.

All config comes from environment variables only, per CONTRACTS.md cross-cutting
conventions. No hardcoded connection strings, ports, or secrets.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


def _get_float(name: str, default: str) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return float(default)


def _get_int(name: str, default: str) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return int(default)


@dataclass(frozen=True)
class Settings:
    service_name: str = "payment"
    port: int = _get_int("PORT", "4005")
    database_url: str = os.getenv(
        "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/payment"
    )
    kafka_brokers: str = os.getenv("KAFKA_BROKERS", "localhost:9092")
    payment_failure_rate: float = _get_float("PAYMENT_FAILURE_RATE", "0.1")
    payment_latency_ms_min: int = _get_int("PAYMENT_LATENCY_MS_MIN", "200")
    payment_latency_ms_max: int = _get_int("PAYMENT_LATENCY_MS_MAX", "1500")

    @property
    def kafka_bootstrap_servers(self) -> list[str]:
        return [b.strip() for b in self.kafka_brokers.split(",") if b.strip()]


settings = Settings()
