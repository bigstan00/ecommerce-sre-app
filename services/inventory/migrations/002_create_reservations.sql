-- Inventory service schema: reservations table
-- Tracks per-order, per-product stock reservations made while processing
-- order.created events, so the saga can compensate (release) them on
-- inventory.failed rollback or payment.failed.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS reservations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL,
    product_id  TEXT NOT NULL,
    quantity    INT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservations_order_id ON reservations (order_id);
CREATE INDEX IF NOT EXISTS idx_reservations_order_status ON reservations (order_id, status);
