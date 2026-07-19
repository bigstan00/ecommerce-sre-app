-- Order service schema: orders + order_items tables.
-- Run against the database referenced by DATABASE_URL before starting the service
-- (or let the server apply it automatically on startup — see internal/db).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS orders (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'inventory_reserved', 'confirmed', 'cancelled')),
    total_amount  NUMERIC(12, 2) NOT NULL,
    cancel_reason TEXT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       UUID NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id     TEXT NOT NULL,
    quantity       INT NOT NULL CHECK (quantity > 0),
    price_snapshot NUMERIC(12, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
