// Package models defines Order domain types and request/response shapes.
package models

import "time"

// Order statuses, per shared/CONTRACTS.md — the saga only ever moves an
// order forward through this sequence (or jumps straight to cancelled).
const (
	StatusPending           = "pending"
	StatusInventoryReserved = "inventory_reserved"
	StatusConfirmed         = "confirmed"
	StatusCancelled         = "cancelled"
)

// Order is the persisted representation of a row in the orders table.
type Order struct {
	ID           string
	UserID       string
	Status       string
	TotalAmount  float64
	CancelReason *string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Items        []OrderItem
}

// OrderItem is the persisted representation of a row in the order_items table.
type OrderItem struct {
	ID            string
	OrderID       string
	ProductID     string
	Quantity      int
	PriceSnapshot float64
}

// OrderItemView is the JSON shape of a single line item in API responses.
type OrderItemView struct {
	ProductID     string  `json:"productId"`
	Quantity      int     `json:"quantity"`
	PriceSnapshot float64 `json:"priceSnapshot"`
}

// OrderView is the JSON shape of an order in API responses, matching the
// GET /orders/:id response shape in shared/CONTRACTS.md.
type OrderView struct {
	OrderID      string          `json:"orderId"`
	Status       string          `json:"status"`
	TotalAmount  float64         `json:"totalAmount"`
	CancelReason *string         `json:"cancelReason"`
	Items        []OrderItemView `json:"items"`
	CreatedAt    time.Time       `json:"createdAt"`
	UpdatedAt    time.Time       `json:"updatedAt"`
}

// AdminOrderView is the JSON shape of a single order in the admin-only
// GET /admin/orders response — it covers orders across all users and, unlike
// OrderView, omits line items since the admin list doesn't need them.
type AdminOrderView struct {
	OrderID      string    `json:"orderId"`
	UserID       string    `json:"userId"`
	Status       string    `json:"status"`
	TotalAmount  float64   `json:"totalAmount"`
	CancelReason *string   `json:"cancelReason"`
	CreatedAt    time.Time `json:"createdAt"`
}

// ToAdminView converts a persisted Order into its admin API response shape.
func (o Order) ToAdminView() AdminOrderView {
	return AdminOrderView{
		OrderID:      o.ID,
		UserID:       o.UserID,
		Status:       o.Status,
		TotalAmount:  o.TotalAmount,
		CancelReason: o.CancelReason,
		CreatedAt:    o.CreatedAt,
	}
}

// ToView converts a persisted Order into its API response shape.
func (o Order) ToView() OrderView {
	items := make([]OrderItemView, 0, len(o.Items))
	for _, it := range o.Items {
		items = append(items, OrderItemView{
			ProductID:     it.ProductID,
			Quantity:      it.Quantity,
			PriceSnapshot: it.PriceSnapshot,
		})
	}
	return OrderView{
		OrderID:      o.ID,
		Status:       o.Status,
		TotalAmount:  o.TotalAmount,
		CancelReason: o.CancelReason,
		Items:        items,
		CreatedAt:    o.CreatedAt,
		UpdatedAt:    o.UpdatedAt,
	}
}
