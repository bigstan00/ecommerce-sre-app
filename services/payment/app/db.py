"""PostgreSQL access layer for the Payment service, via asyncpg.

Owns the `payments` table (per CONTRACTS.md) plus a small internal `order_amounts`
cache table. The cache exists because `inventory.reserved` (the only topic Payment
consumes to drive the saga) carries only `{items: [{productId, quantity}]}` -- no
price data. To populate the `amount` field CONTRACTS.md requires on `payments` /
`payment.completed` / `payment.failed`, Payment additionally listens to the
already-existing `order.created` topic (produced by Order) purely to cache
`totalAmount` per `orderId`. This does not add a new topic, does not change any
existing field/topic name, and does not require any change in Order or Inventory --
it just reads a topic that already carries the data we need. See README for the
full rationale.
"""
from __future__ import annotations

from decimal import Decimal

import asyncpg

from app.config import settings
from app.logging_config import get_logger

logger = get_logger(component="db")

_pool: asyncpg.Pool | None = None


def _to_money(value: float | Decimal) -> Decimal:
    """Normalize a currency amount to an exact 2-decimal-place Decimal before it
    hits a NUMERIC column. Values arrive as JSON-parsed floats (e.g. from Kafka
    envelopes); passing a raw float straight to asyncpg stores the float's full
    binary noise (e.g. 39.97999999999999687...) instead of the intended 39.98.
    Round-tripping through str() first avoids that."""
    if isinstance(value, Decimal):
        return value.quantize(Decimal("0.01"))
    return Decimal(str(round(float(value), 2)))

DDL_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID UNIQUE NOT NULL,
        amount NUMERIC NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        reason TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    # Internal cache, not part of the CONTRACTS.md schema: maps orderId -> totalAmount
    # captured from order.created, so the inventory.reserved handler has a real amount
    # to work with (see module docstring).
    """
    CREATE TABLE IF NOT EXISTS order_amounts (
        order_id UUID PRIMARY KEY,
        total_amount NUMERIC NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
]


async def init_db_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=settings.database_url,
            min_size=1,
            max_size=10,
        )
        async with _pool.acquire() as conn:
            # Needed for gen_random_uuid(); available via pgcrypto on stock Postgres images.
            await conn.execute('CREATE EXTENSION IF NOT EXISTS pgcrypto')
            for statement in DDL_STATEMENTS:
                await conn.execute(statement)
        logger.info("db_pool_initialized")
    return _pool


async def close_db_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("db_pool_closed")


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialized -- call init_db_pool() first")
    return _pool


async def check_db_connectivity() -> bool:
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.execute("SELECT 1")
        return True
    except Exception:
        logger.warning("db_connectivity_check_failed", exc_info=True)
        return False


async def payment_exists(order_id: str) -> bool:
    pool = get_pool()
    row = await pool.fetchrow("SELECT 1 FROM payments WHERE order_id = $1", order_id)
    return row is not None


async def insert_payment(
    order_id: str,
    amount: float,
    status: str,
    reason: str | None,
) -> dict | None:
    """Insert a payments row, idempotently.

    Returns the inserted row as a dict, or None if a row for this order_id already
    existed (ON CONFLICT DO NOTHING) -- callers should treat None as "already
    processed, skip".
    """
    pool = get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO payments (order_id, amount, status, reason)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (order_id) DO NOTHING
        RETURNING id, order_id, amount, status, reason, created_at
        """,
        order_id,
        _to_money(amount),
        status,
        reason,
    )
    return dict(row) if row is not None else None


async def get_payment_by_order_id(order_id: str) -> dict | None:
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT id, order_id, amount, status, reason, created_at FROM payments WHERE order_id = $1",
        order_id,
    )
    return dict(row) if row is not None else None


async def cache_order_amount(order_id: str, total_amount: float) -> None:
    pool = get_pool()
    await pool.execute(
        """
        INSERT INTO order_amounts (order_id, total_amount)
        VALUES ($1, $2)
        ON CONFLICT (order_id) DO UPDATE SET total_amount = EXCLUDED.total_amount
        """,
        order_id,
        _to_money(total_amount),
    )


async def get_cached_order_amount(order_id: str) -> float | None:
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT total_amount FROM order_amounts WHERE order_id = $1", order_id
    )
    return float(row["total_amount"]) if row is not None else None
