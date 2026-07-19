// Package models defines the Inventory service's domain types.
package models

import "time"

// Stock mirrors a row in the `stock` table.
type Stock struct {
	ProductID string    `json:"productId"`
	Available int       `json:"available"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ReservationStatus enumerates the allowed values of reservations.status.
type ReservationStatus string

const (
	ReservationActive   ReservationStatus = "active"
	ReservationReleased ReservationStatus = "released"
)

// Reservation mirrors a row in the `reservations` table.
type Reservation struct {
	ID        string            `json:"id"`
	OrderID   string            `json:"orderId"`
	ProductID string            `json:"productId"`
	Quantity  int               `json:"quantity"`
	Status    ReservationStatus `json:"status"`
	CreatedAt time.Time         `json:"createdAt"`
}

// UpsertStockRequest is the body of POST /inventory.
type UpsertStockRequest struct {
	ProductID string `json:"productId"`
	Available int    `json:"available"`
}

// StockListResponse is the body of GET /inventory.
type StockListResponse struct {
	Items []Stock `json:"items"`
	Total int     `json:"total"`
	Page  int     `json:"page"`
	Limit int     `json:"limit"`
}
