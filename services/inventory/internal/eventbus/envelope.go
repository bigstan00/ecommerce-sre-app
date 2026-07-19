// Package eventbus implements the Kafka envelope, producer, consumer, and
// topic-admin helpers shared by the Inventory service, per the "Kafka
// conventions" section of shared/CONTRACTS.md.
package eventbus

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Topic names, exactly as specified in CONTRACTS.md's "Topics and who owns
// them" table.
const (
	TopicOrderCreated      = "order.created"
	TopicInventoryReserved = "inventory.reserved"
	TopicInventoryFailed   = "inventory.failed"
	TopicPaymentCompleted  = "payment.completed"
	TopicPaymentFailed     = "payment.failed"
	TopicOrderConfirmed    = "order.confirmed"
	TopicOrderCancelled    = "order.cancelled"
)

// Event types, matching the topic name 1:1 per convention.
const (
	EventTypeOrderCreated      = "order.created"
	EventTypeInventoryReserved = "inventory.reserved"
	EventTypeInventoryFailed   = "inventory.failed"
	EventTypePaymentFailed     = "payment.failed"
)

// Envelope is the exact wire format required for every event on every
// topic, per the "Kafka conventions" section of shared/CONTRACTS.md:
//
//	{
//	  "eventId": "uuid-v4",
//	  "eventType": "order.created",
//	  "orderId": "uuid-v4",
//	  "occurredAt": "2026-07-11T10:00:00.000Z",
//	  "data": { }
//	}
//
// occurredAt is kept as a plain string (rather than time.Time) so the
// millisecond-precision, "Z"-suffixed format required by the contract is
// produced and parsed identically regardless of which service (Go, Node,
// Python) is on the other end.
type Envelope struct {
	EventID    string          `json:"eventId"`
	EventType  string          `json:"eventType"`
	OrderID    string          `json:"orderId"`
	OccurredAt string          `json:"occurredAt"`
	Data       json.RawMessage `json:"data"`
}

// NewEnvelope builds an Envelope with a fresh eventId and the current UTC
// timestamp formatted per the contract (millisecond precision, "Z" suffix).
func NewEnvelope(eventType, orderID string, data any) (Envelope, error) {
	payload, err := json.Marshal(data)
	if err != nil {
		return Envelope{}, err
	}
	return Envelope{
		EventID:    uuid.NewString(),
		EventType:  eventType,
		OrderID:    orderID,
		OccurredAt: nowISO(),
		Data:       payload,
	}, nil
}

func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

// OrderCreatedItem is one line item within order.created's data.items.
type OrderCreatedItem struct {
	ProductID     string  `json:"productId"`
	Quantity      int     `json:"quantity"`
	PriceSnapshot float64 `json:"priceSnapshot"`
}

// OrderCreatedData is the `data` payload of an order.created event.
type OrderCreatedData struct {
	UserID      string             `json:"userId"`
	Items       []OrderCreatedItem `json:"items"`
	TotalAmount float64            `json:"totalAmount"`
}

// PaymentFailedData is the `data` payload of a payment.failed event.
type PaymentFailedData struct {
	Reason string  `json:"reason"`
	Amount float64 `json:"amount"`
}

// InventoryReservedItem is one line item within inventory.reserved's
// data.items.
type InventoryReservedItem struct {
	ProductID string `json:"productId"`
	Quantity  int    `json:"quantity"`
}

// InventoryReservedData is the `data` payload of an inventory.reserved
// event, produced by this service.
type InventoryReservedData struct {
	Items []InventoryReservedItem `json:"items"`
}

// InventoryFailedData is the `data` payload of an inventory.failed event,
// produced by this service.
type InventoryFailedData struct {
	Reason string `json:"reason"`
}
