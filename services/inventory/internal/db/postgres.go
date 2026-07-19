// Package db manages the PostgreSQL connection pool and schema migrations
// for the Inventory service.
package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool wraps a pgxpool.Pool for use throughout the service.
type Pool struct {
	*pgxpool.Pool
}

// Connect establishes a connection pool to PostgreSQL using the given DSN.
// It performs an initial ping so callers fail fast on startup if the
// database is unreachable.
func Connect(ctx context.Context, databaseURL string) (*Pool, error) {
	connectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(connectCtx, databaseURL)
	if err != nil {
		return nil, err
	}

	pingCtx, cancelPing := context.WithTimeout(ctx, 5*time.Second)
	defer cancelPing()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, err
	}

	return &Pool{Pool: pool}, nil
}

// Ping checks PostgreSQL connectivity; used by the /readyz handler.
func (p *Pool) Ping(ctx context.Context) error {
	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return p.Pool.Ping(pingCtx)
}
