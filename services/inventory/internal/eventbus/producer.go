package eventbus

import (
	"context"
	"fmt"

	kafka "github.com/segmentio/kafka-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"inventory/internal/metrics"
)

// tracer is used for the "<topic> publish" spans created around each Kafka
// write, per the "Kafka propagation" section of shared/CONTRACTS.md's
// Phase 4.
var tracer = otel.Tracer("inventory/internal/eventbus")

// Producer publishes envelope-wrapped events to Kafka, keyed by orderId so
// all events for one order land on the same partition (per the "Kafka
// conventions" section of CONTRACTS.md).
type Producer struct {
	writer *kafka.Writer
	logger *zap.Logger
}

// NewProducer builds a Producer that writes to the given brokers. The topic
// is specified per-message, so a single writer serves every topic this
// service produces to.
func NewProducer(brokers []string, logger *zap.Logger) *Producer {
	return &Producer{
		writer: &kafka.Writer{
			Addr:                   kafka.TCP(brokers...),
			Balancer:               &kafka.Hash{}, // partitions by message key (orderId)
			RequiredAcks:           kafka.RequireAll,
			AllowAutoTopicCreation: false, // topics are created explicitly via EnsureTopics
		},
		logger: logger,
	}
}

// Publish wraps data in the standard Envelope, keys the Kafka message by
// orderID, and writes it to topic.
//
// Per the "Kafka propagation" section of shared/CONTRACTS.md's Phase 4: the
// span representing this publish is named "<topic> publish", and the
// current trace context carried by ctx (which callers must derive from
// whatever incoming event/request triggered this publish, not a fresh
// context) is injected into the message's "traceparent" Kafka header via
// the global propagator, so a consumer on the other end can continue the
// same trace.
func (p *Producer) Publish(ctx context.Context, topic, eventType, orderID string, data any) error {
	ctx, span := tracer.Start(ctx, topic+" publish",
		trace.WithSpanKind(trace.SpanKindProducer),
		trace.WithAttributes(
			semconv.MessagingSystemKafka,
			semconv.MessagingDestinationName(topic),
			attribute.String("messaging.operation", "publish"),
		),
	)
	defer span.End()

	env, err := NewEnvelope(eventType, orderID, data)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("build envelope: %w", err)
	}

	body, err := jsonMarshal(env)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("marshal envelope: %w", err)
	}

	var headers []kafka.Header
	otel.GetTextMapPropagator().Inject(ctx, KafkaHeaderCarrier{Headers: &headers})

	msg := kafka.Message{
		Topic:   topic,
		Key:     []byte(orderID),
		Value:   body,
		Headers: headers,
	}

	if err := p.writer.WriteMessages(ctx, msg); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("write message: %w", err)
	}

	metrics.EventsProducedTotal.WithLabelValues(topic, eventType).Inc()
	p.logger.Info("event_produced",
		zap.String("eventId", env.EventID),
		zap.String("eventType", env.EventType),
		zap.String("orderId", env.OrderID),
		zap.String("topic", topic),
	)

	return nil
}

// Close flushes and closes the underlying Kafka writer.
func (p *Producer) Close() error {
	return p.writer.Close()
}
