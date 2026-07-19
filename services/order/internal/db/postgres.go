// Package db provides PostgreSQL connectivity and the Order/OrderItem
// repository used by the HTTP handlers and the Kafka consumer.
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"order/migrations"
)

// DB wraps a pgx connection pool.
type DB struct {
	Pool *pgxpool.Pool
}

// Connect opens a PostgreSQL connection pool and verifies connectivity with
// a ping before returning.
func Connect(ctx context.Context, databaseURL string) (*DB, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create pgx pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	return &DB{Pool: pool}, nil
}

// Migrate applies the embedded schema. It is safe to run on every startup:
// every statement is a CREATE ... IF NOT EXISTS, so re-applying is a no-op.
func (d *DB) Migrate(ctx context.Context) error {
	_, err := d.Pool.Exec(ctx, migrations.Schema)
	if err != nil {
		return fmt.Errorf("apply schema migration: %w", err)
	}
	return nil
}

// Ping checks PostgreSQL connectivity, used by the /readyz handler.
func (d *DB) Ping(ctx context.Context) error {
	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return d.Pool.Ping(pingCtx)
}

// Close releases the connection pool.
func (d *DB) Close() {
	d.Pool.Close()
}
