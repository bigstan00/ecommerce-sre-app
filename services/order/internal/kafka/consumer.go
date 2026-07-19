package kafka

import (
	"context"
	"encoding/json"
	"errors"

	segkafka "github.com/segmentio/kafka-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"order/internal/db"
	"order/internal/metrics"
)

// ConsumerGroup is the fixed consumer group id for this service, per the
// "<service-name>-service" convention in shared/CONTRACTS.md.
const ConsumerGroup = "order-service"

// consumedTopics is the full set of topics the Order service's saga
// state-machine reacts to.
var consumedTopics = []string{
	TopicInventoryReserved,
	TopicInventoryFailed,
	TopicPaymentCompleted,
	TopicPaymentFailed,
}

// Consumer runs a single kafka.Reader subscribed to all of consumedTopics
// as one consumer-group member (via GroupTopics), applying the saga's
// state transitions to the orders table and idempotently no-op'ing on
// duplicate or out-of-order deliveries.
//
// A single Reader with GroupTopics is used rather than one Reader per topic
// sharing a GroupID: kafka-go's consumer-group rebalance protocol assumes
// every member of a group subscribes to the same topic set, so multiple
// Readers with heterogeneous per-reader Topic values under one GroupID can
// end up with partitions assigned to the wrong reader and never get
// consumed. GroupTopics is kafka-go's supported way to have one member
// subscribe to several topics at once.
type Consumer struct {
	brokers  []string
	db       *db.DB
	producer *Producer
	logger   *zap.Logger
}

// NewConsumer builds a Consumer.
func NewConsumer(brokers []string, database *db.DB, producer *Producer, logger *zap.Logger) *Consumer {
	return &Consumer{brokers: brokers, db: database, producer: producer, logger: logger}
}

// Run starts the consumer loop and blocks until ctx is cancelled. Intended
// to be launched via `go consumer.Run(ctx)` from main, per the requirement
// that the consumer runs on a separate goroutine from the HTTP server.
func (c *Consumer) Run(ctx context.Context) {
	reader := segkafka.NewReader(segkafka.ReaderConfig{
		Brokers:     c.brokers,
		GroupID:     ConsumerGroup,
		GroupTopics: consumedTopics,
		MinBytes:    1,
		MaxBytes:    10e6,
	})
	defer reader.Close()

	c.logger.Info("kafka consumer started",
		zap.Strings("topics", consumedTopics), zap.String("group", ConsumerGroup))

	for {
		msg, err := reader.ReadMessage(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				c.logger.Info("kafka consumer stopping")
				return
			}
			c.logger.Error("kafka read error", zap.Error(err))
			continue
		}
		topic := msg.Topic

		var env Envelope
		if err := json.Unmarshal(msg.Value, &env); err != nil {
			c.logger.Error("failed to unmarshal event envelope",
				zap.String("topic", topic), zap.Error(err))
			continue
		}

		metrics.EventsConsumedTotal.WithLabelValues(topic, env.EventType).Inc()
		c.logger.Info("event_consumed",
			zap.String("topic", topic),
			zap.String("eventId", env.EventID),
			zap.String("eventType", env.EventType),
			zap.String("orderId", env.OrderID),
		)

		// Extract the traceparent header BEFORE starting the process span,
		// per the Kafka propagation section of shared/CONTRACTS.md, so the
		// span below is a child of the trace the original producer (the
		// HTTP request that started order.created, relayed through
		// Inventory / Payment) started — not a new root trace. msgCtx (not
		// the outer loop ctx) is then threaded through the whole handler
		// chain below, including any follow-up Publish call, so a single
		// incoming event correctly continues the original checkout
		// request's trace across every subsequent Kafka hop.
		extractedCtx := otel.GetTextMapPropagator().Extract(ctx, NewHeaderCarrier(&msg.Headers))
		msgCtx, span := tracer.Start(extractedCtx, topic+" process",
			trace.WithSpanKind(trace.SpanKindConsumer),
			trace.WithAttributes(
				semconv.MessagingSystemKafka,
				semconv.MessagingDestinationName(topic),
				semconv.MessagingOperationTypeDeliver,
				semconv.MessagingKafkaMessageKeyKey.String(env.OrderID),
				attribute.String("messaging.message.id", env.EventID),
				attribute.String("order.event_type", env.EventType),
			),
		)

		if err := c.handle(msgCtx, topic, env); err != nil {
			span.RecordError(err)
			c.logger.Error("failed to handle event",
				zap.String("topic", topic),
				zap.String("eventId", env.EventID),
				zap.String("eventType", env.EventType),
				zap.String("orderId", env.OrderID),
				zap.Error(err))
		}
		span.End()
	}
}

func (c *Consumer) handle(ctx context.Context, topic string, env Envelope) error {
	switch topic {
	case TopicInventoryReserved:
		return c.handleInventoryReserved(ctx, env)
	case TopicInventoryFailed:
		return c.handleInventoryFailed(ctx, env)
	case TopicPaymentCompleted:
		return c.handlePaymentCompleted(ctx, env)
	case TopicPaymentFailed:
		return c.handlePaymentFailed(ctx, env)
	default:
		c.logger.Warn("event on unexpected topic, ignoring", zap.String("topic", topic))
		return nil
	}
}

// handleInventoryReserved: pending -> inventory_reserved. No event
// published — this is just an internal state update per CONTRACTS.md.
func (c *Consumer) handleInventoryReserved(ctx context.Context, env Envelope) error {
	err := c.db.TransitionToInventoryReserved(ctx, env.OrderID)
	if err == nil {
		c.logger.Info("order transitioned",
			zap.String("orderId", env.OrderID),
			zap.String("to", "inventory_reserved"))
		return nil
	}
	return c.logNoOpOrErr(ctx, env, "inventory_reserved", err)
}

// handleInventoryFailed: -> cancelled, cancel_reason set, publish order.cancelled.
func (c *Consumer) handleInventoryFailed(ctx context.Context, env Envelope) error {
	var data InventoryFailedData
	if err := json.Unmarshal(env.Data, &data); err != nil {
		return err
	}

	err := c.db.TransitionToCancelled(ctx, env.OrderID, data.Reason)
	if err == nil {
		c.logger.Info("order transitioned",
			zap.String("orderId", env.OrderID),
			zap.String("to", "cancelled"),
			zap.String("reason", data.Reason))
		return c.producer.Publish(ctx, TopicOrderCancelled, EventOrderCancelled, env.OrderID,
			OrderCancelledData{Reason: data.Reason})
	}
	return c.logNoOpOrErr(ctx, env, "cancelled", err)
}

// handlePaymentCompleted: inventory_reserved -> confirmed, publish order.confirmed.
func (c *Consumer) handlePaymentCompleted(ctx context.Context, env Envelope) error {
	totalAmount, err := c.db.TransitionToConfirmed(ctx, env.OrderID)
	if err == nil {
		c.logger.Info("order transitioned",
			zap.String("orderId", env.OrderID),
			zap.String("to", "confirmed"))
		return c.producer.Publish(ctx, TopicOrderConfirmed, EventOrderConfirmed, env.OrderID,
			OrderConfirmedData{TotalAmount: totalAmount})
	}
	return c.logNoOpOrErr(ctx, env, "confirmed", err)
}

// handlePaymentFailed: -> cancelled, cancel_reason set, publish order.cancelled.
func (c *Consumer) handlePaymentFailed(ctx context.Context, env Envelope) error {
	var data PaymentFailedData
	if err := json.Unmarshal(env.Data, &data); err != nil {
		return err
	}

	err := c.db.TransitionToCancelled(ctx, env.OrderID, data.Reason)
	if err == nil {
		c.logger.Info("order transitioned",
			zap.String("orderId", env.OrderID),
			zap.String("to", "cancelled"),
			zap.String("reason", data.Reason))
		return c.producer.Publish(ctx, TopicOrderCancelled, EventOrderCancelled, env.OrderID,
			OrderCancelledData{Reason: data.Reason})
	}
	return c.logNoOpOrErr(ctx, env, "cancelled", err)
}

// logNoOpOrErr distinguishes the expected idempotency no-op (order wasn't
// in the required prior state, e.g. a duplicate delivery) from a genuine
// error, logging the former at info level without treating it as a failure.
func (c *Consumer) logNoOpOrErr(ctx context.Context, env Envelope, attemptedTo string, err error) error {
	if errors.Is(err, db.ErrNoTransition) {
		current, statusErr := c.db.GetOrderStatus(ctx, env.OrderID)
		if statusErr != nil {
			current = "unknown"
		}
		c.logger.Info("duplicate or out-of-order event, no-op",
			zap.String("orderId", env.OrderID),
			zap.String("eventType", env.EventType),
			zap.String("attemptedTransition", attemptedTo),
			zap.String("currentStatus", current))
		return nil
	}
	if errors.Is(err, db.ErrNotFound) {
		c.logger.Warn("event for unknown order, no-op",
			zap.String("orderId", env.OrderID),
			zap.String("eventType", env.EventType))
		return nil
	}
	return err
}
