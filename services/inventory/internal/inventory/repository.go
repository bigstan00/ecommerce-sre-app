// Package inventory implements the Inventory service's core business
// logic: stock lookups/upserts, and the reserve/release saga steps driven
// by Kafka events, per the "Inventory Service" section of
// shared/CONTRACTS.md.
package inventory

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"inventory/internal/db"
	"inventory/internal/models"
)

// ErrNotFound is returned when a stock row doesn't exist.
var ErrNotFound = errors.New("not found")

// Repository provides PostgreSQL-backed access to the stock and
// reservations tables.
type Repository struct {
	pool *db.Pool
}

// NewRepository builds a Repository backed by pool.
func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// GetStock returns the stock row for productID, or ErrNotFound.
func (r *Repository) GetStock(ctx context.Context, productID string) (models.Stock, error) {
	var s models.Stock
	err := r.pool.QueryRow(ctx,
		`SELECT product_id, available, updated_at FROM stock WHERE product_id = $1`,
		productID,
	).Scan(&s.ProductID, &s.Available, &s.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Stock{}, ErrNotFound
		}
		return models.Stock{}, err
	}
	return s, nil
}

// ListStock returns a page of stock rows ordered by product_id, along with
// the total row count across all pages (for admin dashboard pagination).
func (r *Repository) ListStock(ctx context.Context, limit, offset int) ([]models.Stock, int, error) {
	var total int
	if err := r.pool.QueryRow(ctx, `SELECT count(*) FROM stock`).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := r.pool.Query(ctx, `
		SELECT product_id, available, updated_at
		FROM stock
		ORDER BY product_id
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]models.Stock, 0)
	for rows.Next() {
		var s models.Stock
		if err := rows.Scan(&s.ProductID, &s.Available, &s.UpdatedAt); err != nil {
			return nil, 0, err
		}
		items = append(items, s)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	return items, total, nil
}

// UpsertStock inserts or updates the available quantity for productID.
func (r *Repository) UpsertStock(ctx context.Context, productID string, available int) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO stock (product_id, available, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (product_id)
		DO UPDATE SET available = EXCLUDED.available, updated_at = now()
	`, productID, available)
	return err
}

// DecrementStock atomically decrements available stock for productID by
// quantity, but only if enough stock is available. Returns ok=false (with
// no error) if there wasn't enough stock, rather than erroring, so callers
// can distinguish "insufficient stock" from a real failure.
func (r *Repository) DecrementStock(ctx context.Context, productID string, quantity int) (ok bool, err error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE stock
		SET available = available - $1, updated_at = now()
		WHERE product_id = $2 AND available >= $1
	`, quantity, productID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// RestoreStock atomically adds quantity back to available stock for
// productID. Used both for saga rollback (insufficient stock on a later
// item) and for payment.failed compensation.
func (r *Repository) RestoreStock(ctx context.Context, productID string, quantity int) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE stock
		SET available = available + $1, updated_at = now()
		WHERE product_id = $2
	`, quantity, productID)
	return err
}

// InsertReservation inserts a new active reservation row and returns its id.
func (r *Repository) InsertReservation(ctx context.Context, orderID, productID string, quantity int) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO reservations (order_id, product_id, quantity, status)
		VALUES ($1, $2, $3, 'active')
		RETURNING id
	`, orderID, productID, quantity).Scan(&id)
	return id, err
}

// ReservationsForOrder returns every reservation row for orderID,
// regardless of status. Used for the order.created idempotency guard: if
// any rows already exist, this order.created event has already been
// processed (successfully or otherwise) and must not be reprocessed.
func (r *Repository) ReservationsForOrder(ctx context.Context, orderID string) ([]models.Reservation, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, order_id, product_id, quantity, status, created_at
		FROM reservations
		WHERE order_id = $1
	`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanReservations(rows)
}

// ActiveReservationsForOrder returns only the active reservation rows for
// orderID. Used by the payment.failed compensation handler.
func (r *Repository) ActiveReservationsForOrder(ctx context.Context, orderID string) ([]models.Reservation, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, order_id, product_id, quantity, status, created_at
		FROM reservations
		WHERE order_id = $1 AND status = 'active'
	`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanReservations(rows)
}

// ReleaseReservation atomically transitions a reservation from active to
// released and restores its stock, but only if it is still active — this
// is what makes both rollback (insufficient stock) and payment.failed
// compensation idempotent under duplicate Kafka delivery. Returns
// released=false if the reservation was already released (or doesn't
// exist), in which case no stock was touched.
func (r *Repository) ReleaseReservation(ctx context.Context, reservationID string) (released bool, err error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var productID string
	var quantity int
	err = tx.QueryRow(ctx, `
		UPDATE reservations
		SET status = 'released'
		WHERE id = $1 AND status = 'active'
		RETURNING product_id, quantity
	`, reservationID).Scan(&productID, &quantity)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE stock
		SET available = available + $1, updated_at = now()
		WHERE product_id = $2
	`, quantity, productID); err != nil {
		return false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}

	return true, nil
}

func scanReservations(rows pgx.Rows) ([]models.Reservation, error) {
	out := make([]models.Reservation, 0)
	for rows.Next() {
		var res models.Reservation
		if err := rows.Scan(&res.ID, &res.OrderID, &res.ProductID, &res.Quantity, &res.Status, &res.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, res)
	}
	return out, rows.Err()
}
