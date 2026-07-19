-- Inventory service schema: stock table
-- Run against the database referenced by DATABASE_URL before starting the service
-- (the server applies migrations automatically on startup, but this file also
-- documents the schema for manual inspection).

CREATE TABLE IF NOT EXISTS stock (
    product_id  TEXT PRIMARY KEY,
    available   INT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
