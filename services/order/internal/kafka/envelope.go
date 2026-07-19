// Package kafka implements the Order service's Kafka producer (topic
// creation + publishing order.created / order.confirmed / order.cancelled)
// and consumer (the saga state-machine driven by inventory.* and payment.*
// events), per the envelope and conventions in shared/CONTRACTS.md.
package kafka

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Topic names, exactly as specified in shared/CONTRACTS.md.
const (
	TopicOrderCreated      = "order.created"
	TopicOrderConfirmed    = "order.confirmed"
	TopicOrderCancelled    = "order.cancelled"
	TopicInventoryReserved = "inventory.reserved"
	TopicInventoryFailed   = "inventory.failed"
	TopicPaymentCompleted  = "payment.completed"
	TopicPaymentFailed     = "payment.failed"
)

// EventType values, matching the topic names 1:1 in this system.
const (
	EventOrderCreated      = "order.created"
	EventOrderConfirmed    = "order.confirmed"
	EventOrderCancelled    = "order.cancelled"
	EventInventoryReserved = "inventory.reserved"
	EventInventoryFailed   = "inventory.failed"
	EventPaymentCompleted  = "payment.completed"
	EventPaymentFailed     = "payment.failed"
)

// Envelope is the exact event envelope shape required by every
// producer/consumer in the system per shared/CONTRACTS.md.
type Envelope struct {
	EventID    string          `json:"eventId"`
	EventType  string          `json:"eventType"`
	OrderID    string          `json:"orderId"`
	OccurredAt string          `json:"occurredAt"`
	Data       json.RawMessage `json:"data"`
}

// NewEnvelope builds an Envelope with a fresh eventId and the current time
// formatted per the millisecond-precision UTC example in CONTRACTS.md
// ("2026-07-11T10:00:00.000Z").
func NewEnvelope(eventType, orderID string, data any) (Envelope, error) {
	payload, err := json.Marshal(data)
	if err != nil {
		return Envelope{}, err
	}
	return Envelope{
		EventID:    uuid.New().String(),
		EventType:  eventType,
		OrderID:    orderID,
		OccurredAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		Data:       payload,
	}, nil
}

// OrderCreatedData is the `data` payload for order.created.
type OrderCreatedData struct {
	UserID      string             `json:"userId"`
	Items       []OrderCreatedItem `json:"items"`
	TotalAmount float64            `json:"totalAmount"`
}

// OrderCreatedItem is a single line item in the order.created payload.
type OrderCreatedItem struct {
	ProductID     string  `json:"productId"`
	Quantity      int     `json:"quantity"`
	PriceSnapshot float64 `json:"priceSnapshot"`
}

// OrderConfirmedData is the `data` payload for order.confirmed.
type OrderConfirmedData struct {
	TotalAmount float64 `json:"totalAmount"`
}

// OrderCancelledData is the `data` payload for order.cancelled.
type OrderCancelledData struct {
	Reason string `json:"reason"`
}

// InventoryReservedData is the `data` payload for inventory.reserved (as
// consumed by the Order service — item detail isn't needed for the saga's
// state transition, only the envelope's orderId).
type InventoryReservedData struct {
	Items []InventoryReservedItem `json:"items"`
}

// InventoryReservedItem is a single line item in the inventory.reserved payload.
type InventoryReservedItem struct {
	ProductID string `json:"productId"`
	Quantity  int    `json:"quantity"`
}

// InventoryFailedData is the `data` payload for inventory.failed.
type InventoryFailedData struct {
	Reason string `json:"reason"`
}

// PaymentCompletedData is the `data` payload for payment.completed.
type PaymentCompletedData struct {
	PaymentID string  `json:"paymentId"`
	Amount    float64 `json:"amount"`
}

// PaymentFailedData is the `data` payload for payment.failed.
type PaymentFailedData struct {
	Reason string  `json:"reason"`
	Amount float64 `json:"amount"`
}
