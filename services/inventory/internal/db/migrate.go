package db

import (
	"context"
	"fmt"
	"sort"

	"inventory/migrations"
)

// Migrate applies every *.sql file embedded in the migrations package, in
// filename order, tracking applied files in a schema_migrations table so
// re-running on every startup is a no-op once a migration has landed.
//
// This is a minimal, dependency-free migration runner appropriate for a
// learning project; a production system would use a dedicated migration
// tool.
func Migrate(ctx context.Context, pool *Pool) error {
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename    TEXT PRIMARY KEY,
			applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`); err != nil {
		return fmt.Errorf("failed to ensure schema_migrations table: %w", err)
	}

	entries, err := migrations.FS.ReadDir(".")
	if err != nil {
		return fmt.Errorf("failed to read embedded migrations: %w", err)
	}

	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && len(e.Name()) > 4 && e.Name()[len(e.Name())-4:] == ".sql" {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var alreadyApplied bool
		err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = $1)`, name).Scan(&alreadyApplied)
		if err != nil {
			return fmt.Errorf("failed to check migration status for %s: %w", name, err)
		}
		if alreadyApplied {
			continue
		}

		sqlBytes, err := migrations.FS.ReadFile(name)
		if err != nil {
			return fmt.Errorf("failed to read migration %s: %w", name, err)
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("failed to begin transaction for migration %s: %w", name, err)
		}

		if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("failed to apply migration %s: %w", name, err)
		}

		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (filename) VALUES ($1)`, name); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("failed to record migration %s: %w", name, err)
		}

		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("failed to commit migration %s: %w", name, err)
		}
	}

	return nil
}
