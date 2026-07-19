"""Environment-driven configuration for the Notification service.

Every setting comes from an environment variable, per shared/CONTRACTS.md's
cross-cutting conventions. See .env.example for the full list with defaults.
"""
import os

from dotenv import load_dotenv

# Load a local .env file if present (no-op in containers where env vars are
# injected directly by the orchestrator).
load_dotenv()


class Settings:
    def __init__(self) -> None:
        self.service_name = "notification"
        self.port = int(os.getenv("PORT", "4007"))
        self.kafka_brokers = os.getenv("KAFKA_BROKERS", "localhost:9092")
        self.log_level = os.getenv("LOG_LEVEL", "info")


settings = Settings()
