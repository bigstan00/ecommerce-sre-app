package inventory

import (
	"context"
	"encoding/json"
	"fmt"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"inventory/internal/eventbus"
)

// tracer names the child span created around the payment.failed
// reservation-release path (see HandlePaymentFailed) — that path never
// publishes a new event, so without an explicit span here it would
// otherwise be invisible inside its parent "payment.failed process" span,
// per the "Kafka propagation" section of shared/CONTRACTS.md's Phase 4.
var tracer = otel.Tracer("inventory/internal/inventory")

// Service implements the reserve/release saga steps the Inventory service
// performs in response to Kafka events, per the "The saga, end to end"
// section of shared/CONTRACTS.md:
//
//   - order.created   -> attempt to reserve every line item; publish
//     inventory.reserved on full success, or roll back any partial
//     reservations and publish inventory.failed on any shortage.
//   - payment.failed  -> release this order's active reservations,
//     restoring stock. No event published (compensation, not a new fact).
type Service struct {
	repo     *Repository
	producer *eventbus.Producer
	logger   *zap.Logger
}

// NewService builds a Service.
func NewService(repo *Repository, producer *eventbus.Producer, logger *zap.Logger) *Service {
	return &Service{repo: repo, producer: producer, logger: logger}
}

// HandleOrderCreated implements the order.created consumer behavior.
func (s *Service) HandleOrderCreated(ctx context.Context, env eventbus.Envelope) error {
	orderID := env.OrderID

	var data eventbus.OrderCreatedData
	if err := json.Unmarshal(env.Data, &data); err != nil {
		return fmt.Errorf("unmarshal order.created data: %w", err)
	}

	// Idempotency guard: if this order already has any reservation rows
	// (active from a prior success, or released from a prior
	// failure/rollback), this is a duplicate delivery of an event we've
	// already fully processed. Don't double-decrement stock or
	// double-publish.
	existing, err := s.repo.ReservationsForOrder(ctx, orderID)
	if err != nil {
		return fmt.Errorf("check existing reservations: %w", err)
	}
	if len(existing) > 0 {
		s.logger.Info("duplicate order.created ignored, order already processed",
			zap.String("orderId", orderID),
			zap.Int("existingReservations", len(existing)),
		)
		return nil
	}

	type succeededReservation struct {
		id        string
		productID string
		quantity  int
	}

	succeeded := make([]succeededReservation, 0, len(data.Items))
	shortProductID := ""

	for _, item := range data.Items {
		ok, err := s.repo.DecrementStock(ctx, item.ProductID, item.Quantity)
		if err != nil {
			return fmt.Errorf("decrement stock for %s: %w", item.ProductID, err)
		}
		if !ok {
			shortProductID = item.ProductID
			break
		}

		resID, err := s.repo.InsertReservation(ctx, orderID, item.ProductID, item.Quantity)
		if err != nil {
			return fmt.Errorf("insert reservation for %s: %w", item.ProductID, err)
		}
		succeeded = append(succeeded, succeededReservation{id: resID, productID: item.ProductID, quantity: item.Quantity})
	}

	if shortProductID == "" {
		// Every item reserved successfully.
		reservedItems := make([]eventbus.InventoryReservedItem, 0, len(data.Items))
		for _, item := range data.Items {
			reservedItems = append(reservedItems, eventbus.InventoryReservedItem{
				ProductID: item.ProductID,
				Quantity:  item.Quantity,
			})
		}

		s.logger.Info("all items reserved for order",
			zap.String("orderId", orderID),
			zap.Int("itemCount", len(reservedItems)),
		)

		return s.producer.Publish(ctx, eventbus.TopicInventoryReserved, eventbus.EventTypeInventoryReserved, orderID,
			eventbus.InventoryReservedData{Items: reservedItems})
	}

	// Insufficient stock for shortProductID: roll back whatever we
	// already reserved for this order.
	s.logger.Warn("insufficient stock, rolling back partial reservations",
		zap.String("orderId", orderID),
		zap.String("shortProductId", shortProductID),
		zap.Int("partialReservations", len(succeeded)),
	)

	for _, r := range succeeded {
		released, err := s.repo.ReleaseReservation(ctx, r.id)
		if err != nil {
			return fmt.Errorf("rollback reservation %s (product %s): %w", r.id, r.productID, err)
		}
		if !released {
			s.logger.Warn("rollback found reservation already released",
				zap.String("orderId", orderID), zap.String("reservationId", r.id))
		}
	}

	reason := fmt.Sprintf("insufficient stock: %s", shortProductID)
	return s.producer.Publish(ctx, eventbus.TopicInventoryFailed, eventbus.EventTypeInventoryFailed, orderID,
		eventbus.InventoryFailedData{Reason: reason})
}

// HandlePaymentFailed implements the payment.failed consumer behavior:
// compensating release of this order's active reservations. No event is
// published — this is compensation, not a new business fact.
//
// Because there's no outgoing publish here to carry the trace forward, this
// method creates its own child span ("inventory.release") under the
// context it's given (which the Kafka consumer has already set up as a
// child of the extracted payment.failed trace context), so the release
// work is still visible in the trace even without a corresponding
// published event — per the "Kafka propagation" section of
// shared/CONTRACTS.md's Phase 4.
func (s *Service) HandlePaymentFailed(ctx context.Context, env eventbus.Envelope) error {
	ctx, span := tracer.Start(ctx, "inventory.release",
		trace.WithAttributes(attribute.String("orderId", env.OrderID)),
	)
	defer span.End()

	orderID := env.OrderID

	active, err := s.repo.ActiveReservationsForOrder(ctx, orderID)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("look up active reservations: %w", err)
	}

	if len(active) == 0 {
		s.logger.Info("payment.failed: no active reservations to release (already released, or none existed)",
			zap.String("orderId", orderID))
		span.SetAttributes(attribute.Int("releasedCount", 0))
		return nil
	}

	releasedCount := 0
	for _, r := range active {
		released, err := s.repo.ReleaseReservation(ctx, r.ID)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			return fmt.Errorf("release reservation %s (product %s): %w", r.ID, r.ProductID, err)
		}
		if released {
			releasedCount++
			s.logger.Info("released reservation and restored stock",
				zap.String("orderId", orderID),
				zap.String("productId", r.ProductID),
				zap.Int("quantity", r.Quantity),
			)
		}
	}

	span.SetAttributes(attribute.Int("releasedCount", releasedCount))
	return nil
}
