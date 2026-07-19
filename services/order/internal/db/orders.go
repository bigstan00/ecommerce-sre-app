package db

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"order/internal/models"
)

// ErrNotFound is returned when a lookup finds no matching row.
var ErrNotFound = errors.New("not found")

// ErrNoTransition is returned when a conditional status-transition UPDATE
// affected zero rows — i.e. the order was not in the expected prior state.
// Callers use this to implement idempotent Kafka consumer handlers.
var ErrNoTransition = errors.New("no transition applied")

// NewOrderItem is the input shape for creating a single order line item.
type NewOrderItem struct {
	ProductID     string
	Quantity      int
	PriceSnapshot float64
}

// CreateOrder inserts an order row (status=pending) plus its order_items
// rows in a single transaction and returns the persisted Order.
func (d *DB) CreateOrder(ctx context.Context, userID string, totalAmount float64, items []NewOrderItem) (models.Order, error) {
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return models.Order{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var order models.Order
	err = tx.QueryRow(ctx, `
		INSERT INTO orders (user_id, status, total_amount)
		VALUES ($1, $2, $3)
		RETURNING id, user_id, status, total_amount, cancel_reason, created_at, updated_at
	`, userID, models.StatusPending, totalAmount).Scan(
		&order.ID, &order.UserID, &order.Status, &order.TotalAmount,
		&order.CancelReason, &order.CreatedAt, &order.UpdatedAt,
	)
	if err != nil {
		return models.Order{}, fmt.Errorf("insert order: %w", err)
	}

	for _, item := range items {
		var oi models.OrderItem
		err = tx.QueryRow(ctx, `
			INSERT INTO order_items (order_id, product_id, quantity, price_snapshot)
			VALUES ($1, $2, $3, $4)
			RETURNING id, order_id, product_id, quantity, price_snapshot
		`, order.ID, item.ProductID, item.Quantity, item.PriceSnapshot).Scan(
			&oi.ID, &oi.OrderID, &oi.ProductID, &oi.Quantity, &oi.PriceSnapshot,
		)
		if err != nil {
			return models.Order{}, fmt.Errorf("insert order_item: %w", err)
		}
		order.Items = append(order.Items, oi)
	}

	if err := tx.Commit(ctx); err != nil {
		return models.Order{}, fmt.Errorf("commit tx: %w", err)
	}

	return order, nil
}

// GetOrder fetches an order (and its items) by id, scoped to userID. Returns
// ErrNotFound if no matching row exists.
func (d *DB) GetOrder(ctx context.Context, orderID, userID string) (models.Order, error) {
	var order models.Order
	err := d.Pool.QueryRow(ctx, `
		SELECT id, user_id, status, total_amount, cancel_reason, created_at, updated_at
		FROM orders
		WHERE id = $1 AND user_id = $2
	`, orderID, userID).Scan(
		&order.ID, &order.UserID, &order.Status, &order.TotalAmount,
		&order.CancelReason, &order.CreatedAt, &order.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.Order{}, ErrNotFound
	}
	if err != nil {
		return models.Order{}, fmt.Errorf("query order: %w", err)
	}

	items, err := d.listOrderItems(ctx, order.ID)
	if err != nil {
		return models.Order{}, err
	}
	order.Items = items

	return order, nil
}

// ListOrders returns all orders for userID, newest first, each with its items.
func (d *DB) ListOrders(ctx context.Context, userID string) ([]models.Order, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT id, user_id, status, total_amount, cancel_reason, created_at, updated_at
		FROM orders
		WHERE user_id = $1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("query orders: %w", err)
	}
	defer rows.Close()

	var orders []models.Order
	for rows.Next() {
		var order models.Order
		if err := rows.Scan(
			&order.ID, &order.UserID, &order.Status, &order.TotalAmount,
			&order.CancelReason, &order.CreatedAt, &order.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan order: %w", err)
		}
		orders = append(orders, order)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate orders: %w", err)
	}

	for i := range orders {
		items, err := d.listOrderItems(ctx, orders[i].ID)
		if err != nil {
			return nil, err
		}
		orders[i].Items = items
	}

	return orders, nil
}

// ListOrdersAdmin returns orders across ALL users, optionally filtered to a
// single status, newest first, paginated. It backs the admin-gated
// GET /admin/orders endpoint and deliberately does not load each order's
// line items, since the admin response shape omits them (unlike ListOrders).
func (d *DB) ListOrdersAdmin(ctx context.Context, status string, page, limit int) ([]models.Order, int, error) {
	var (
		args  []any
		where string
	)
	if status != "" {
		where = "WHERE status = $1"
		args = append(args, status)
	}

	var total int
	countQuery := fmt.Sprintf(`SELECT count(*) FROM orders %s`, where)
	if err := d.Pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count admin orders: %w", err)
	}

	limitArg := len(args) + 1
	offsetArg := len(args) + 2
	query := fmt.Sprintf(`
		SELECT id, user_id, status, total_amount, cancel_reason, created_at, updated_at
		FROM orders
		%s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d
	`, where, limitArg, offsetArg)
	args = append(args, limit, (page-1)*limit)

	rows, err := d.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("query admin orders: %w", err)
	}
	defer rows.Close()

	var orders []models.Order
	for rows.Next() {
		var order models.Order
		if err := rows.Scan(
			&order.ID, &order.UserID, &order.Status, &order.TotalAmount,
			&order.CancelReason, &order.CreatedAt, &order.UpdatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan order: %w", err)
		}
		orders = append(orders, order)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate admin orders: %w", err)
	}

	return orders, total, nil
}

func (d *DB) listOrderItems(ctx context.Context, orderID string) ([]models.OrderItem, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT id, order_id, product_id, quantity, price_snapshot
		FROM order_items
		WHERE order_id = $1
	`, orderID)
	if err != nil {
		return nil, fmt.Errorf("query order_items: %w", err)
	}
	defer rows.Close()

	var items []models.OrderItem
	for rows.Next() {
		var it models.OrderItem
		if err := rows.Scan(&it.ID, &it.OrderID, &it.ProductID, &it.Quantity, &it.PriceSnapshot); err != nil {
			return nil, fmt.Errorf("scan order_item: %w", err)
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate order_items: %w", err)
	}
	return items, nil
}

// GetOrderStatus returns the current status of an order by id, used by the
// Kafka consumer to log the "already in state X" context on no-op transitions.
func (d *DB) GetOrderStatus(ctx context.Context, orderID string) (string, error) {
	var status string
	err := d.Pool.QueryRow(ctx, `SELECT status FROM orders WHERE id = $1`, orderID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("query order status: %w", err)
	}
	return status, nil
}

// TransitionToInventoryReserved moves an order from pending to
// inventory_reserved. Returns ErrNoTransition if the order was not in
// pending state (idempotent no-op for duplicate inventory.reserved events).
func (d *DB) TransitionToInventoryReserved(ctx context.Context, orderID string) error {
	tag, err := d.Pool.Exec(ctx, `
		UPDATE orders SET status = $2, updated_at = now()
		WHERE id = $1 AND status = $3
	`, orderID, models.StatusInventoryReserved, models.StatusPending)
	if err != nil {
		return fmt.Errorf("update order status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNoTransition
	}
	return nil
}

// TransitionToConfirmed moves an order from inventory_reserved to confirmed.
// Returns ErrNoTransition if the order was not in inventory_reserved state
// (idempotent no-op for duplicate payment.completed events). Also returns
// the order's total_amount for use in the order.confirmed event payload.
func (d *DB) TransitionToConfirmed(ctx context.Context, orderID string) (float64, error) {
	var totalAmount float64
	err := d.Pool.QueryRow(ctx, `
		UPDATE orders SET status = $2, updated_at = now()
		WHERE id = $1 AND status = $3
		RETURNING total_amount
	`, orderID, models.StatusConfirmed, models.StatusInventoryReserved).Scan(&totalAmount)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNoTransition
	}
	if err != nil {
		return 0, fmt.Errorf("update order status: %w", err)
	}
	return totalAmount, nil
}

// TransitionToCancelled moves an order to cancelled with the given reason,
// as long as it is not already in a terminal state (confirmed or
// cancelled). Returns ErrNoTransition otherwise (idempotent no-op for
// duplicate inventory.failed / payment.failed events).
func (d *DB) TransitionToCancelled(ctx context.Context, orderID, reason string) error {
	tag, err := d.Pool.Exec(ctx, `
		UPDATE orders SET status = $2, cancel_reason = $3, updated_at = now()
		WHERE id = $1 AND status NOT IN ($4, $2)
	`, orderID, models.StatusCancelled, reason, models.StatusConfirmed)
	if err != nil {
		return fmt.Errorf("update order status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNoTransition
	}
	return nil
}
