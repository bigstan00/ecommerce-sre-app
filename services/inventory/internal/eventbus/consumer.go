package eventbus

import (
	"context"
	"encoding/json"
	"time"

	kafka "github.com/segmentio/kafka-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"inventory/internal/metrics"
)

// Handler processes one decoded event envelope. Returning an error causes
// the message to NOT be committed, so it will be redelivered (at-least-once)
// on the next fetch after a consumer restart/rebalance — handlers must be
// idempotent per the "Kafka conventions" section of CONTRACTS.md.
type Handler func(ctx context.Context, env Envelope) error

// Consumer reads from a set of topics under a single consumer group and
// dispatches each event to the handler registered for its topic.
type Consumer struct {
	reader   *kafka.Reader
	logger   *zap.Logger
	handlers map[string]Handler
}

// NewConsumer builds a Consumer subscribed to topics under the given
// consumer group id (per convention: "<service-name>-service").
func NewConsumer(brokers []string, groupID string, topics []string, logger *zap.Logger) *Consumer {
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:     brokers,
		GroupID:     groupID,
		GroupTopics: topics,
		MinBytes:    1,
		MaxBytes:    10e6,
		MaxWait:     1 * time.Second,
	})

	return &Consumer{
		reader:   reader,
		logger:   logger,
		handlers: make(map[string]Handler),
	}
}

// On registers the handler invoked for events consumed from topic.
func (c *Consumer) On(topic string, h Handler) {
	c.handlers[topic] = h
}

// Run blocks, fetching and dispatching events until ctx is cancelled.
func (c *Consumer) Run(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}

		msg, err := c.reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			c.logger.Error("kafka fetch failed, retrying", zap.Error(err))
			time.Sleep(time.Second)
			continue
		}

		var env Envelope
		if err := json.Unmarshal(msg.Value, &env); err != nil {
			c.logger.Error("failed to decode event envelope, skipping (poison message)",
				zap.Error(err), zap.String("topic", msg.Topic))
			c.commit(ctx, msg)
			continue
		}

		c.logger.Info("event_consumed",
			zap.String("eventId", env.EventID),
			zap.String("eventType", env.EventType),
			zap.String("orderId", env.OrderID),
			zap.String("topic", msg.Topic),
		)

		// Per the "Kafka propagation" section of shared/CONTRACTS.md's
		// Phase 4: extract the "traceparent" header this message was
		// published with (if any) BEFORE processing, and use the resulting
		// context as the parent for a new "<topic> process" span, so this
		// handler's work — and anything it publishes downstream — shows up
		// as part of the same trace the original producer started, rather
		// than a disconnected root trace.
		propagatedCtx := otel.GetTextMapPropagator().Extract(ctx, KafkaHeaderCarrier{Headers: &msg.Headers})
		msgCtx, span := tracer.Start(propagatedCtx, msg.Topic+" process",
			trace.WithSpanKind(trace.SpanKindConsumer),
			trace.WithAttributes(
				semconv.MessagingSystemKafka,
				semconv.MessagingDestinationName(msg.Topic),
				attribute.String("messaging.operation", "process"),
				attribute.String("orderId", env.OrderID),
				attribute.String("eventId", env.EventID),
			),
		)

		handler, ok := c.handlers[msg.Topic]
		if !ok {
			c.logger.Warn("no handler registered for topic, skipping", zap.String("topic", msg.Topic))
			span.End()
			c.commit(ctx, msg)
			continue
		}

		if err := c.handleWithRetry(msgCtx, handler, env); err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			span.End()
			metrics.EventsConsumedTotal.WithLabelValues(msg.Topic, env.EventType, "error").Inc()
			c.logger.Error("handler failed, message will be redelivered on restart",
				zap.Error(err),
				zap.String("eventId", env.EventID),
				zap.String("eventType", env.EventType),
				zap.String("orderId", env.OrderID),
			)
			// Do not commit: at-least-once redelivery relies on the offset
			// not being advanced past this message.
			continue
		}

		span.End()
		metrics.EventsConsumedTotal.WithLabelValues(msg.Topic, env.EventType, "ok").Inc()
		c.commit(ctx, msg)
	}
}

// handleWithRetry gives a handler a few immediate attempts to ride out
// transient errors (e.g. a momentary DB blip) before giving up for this
// session and leaving the message uncommitted for redelivery.
func (c *Consumer) handleWithRetry(ctx context.Context, h Handler, env Envelope) error {
	const maxAttempts = 3
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		lastErr = h(ctx, env)
		if lastErr == nil {
			return nil
		}
		if attempt < maxAttempts {
			time.Sleep(time.Duration(attempt) * 200 * time.Millisecond)
		}
	}
	return lastErr
}

func (c *Consumer) commit(ctx context.Context, msg kafka.Message) {
	if err := c.reader.CommitMessages(ctx, msg); err != nil {
		c.logger.Error("failed to commit kafka offset", zap.Error(err))
	}
}

// Close closes the underlying Kafka reader.
func (c *Consumer) Close() error {
	return c.reader.Close()
}
