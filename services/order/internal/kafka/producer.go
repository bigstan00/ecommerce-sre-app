package kafka

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strconv"
	"time"

	segkafka "github.com/segmentio/kafka-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"order/internal/metrics"
)

// tracer is this package's OTel tracer, used for the "<topic> publish"
// spans described in the Kafka propagation section of
// shared/CONTRACTS.md.
var tracer = otel.Tracer("order-service/kafka")

// Producer publishes envelope-wrapped events to Kafka, keyed by orderId so
// all events for one order land on the same partition (per CONTRACTS.md).
type Producer struct {
	writer *segkafka.Writer
	logger *zap.Logger
}

// NewProducer builds a Producer backed by a single kafka.Writer shared
// across all topics this service produces to (topic is set per-message).
func NewProducer(brokers []string, logger *zap.Logger) *Producer {
	return &Producer{
		writer: &segkafka.Writer{
			Addr:                   segkafka.TCP(brokers...),
			Balancer:               &segkafka.Hash{},
			RequiredAcks:           segkafka.RequireOne,
			AllowAutoTopicCreation: false,
			BatchTimeout:           50 * time.Millisecond,
		},
		logger: logger,
	}
}

// Close flushes and closes the underlying writer.
func (p *Producer) Close() error {
	return p.writer.Close()
}

// Publish builds an envelope for eventType/orderId/data, marshals it, and
// writes it to topic keyed by orderId.
//
// Per the Kafka propagation section of shared/CONTRACTS.md: the trace
// context active in ctx (e.g. the HTTP request span for order.created, or
// the "<topic> process" span for a saga-triggered order.confirmed /
// order.cancelled) is injected into a `traceparent` Kafka header via the
// global TextMapPropagator, and the publish itself is wrapped in a
// "<topic> publish" span. This is what lets a trace started at
// POST /orders continue across every downstream Kafka hop.
func (p *Producer) Publish(ctx context.Context, topic, eventType, orderID string, data any) error {
	env, err := NewEnvelope(eventType, orderID, data)
	if err != nil {
		return fmt.Errorf("build envelope: %w", err)
	}
	body, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("marshal envelope: %w", err)
	}

	ctx, span := tracer.Start(ctx, topic+" publish",
		trace.WithSpanKind(trace.SpanKindProducer),
		trace.WithAttributes(
			semconv.MessagingSystemKafka,
			semconv.MessagingDestinationName(topic),
			semconv.MessagingOperationTypePublish,
			semconv.MessagingKafkaMessageKeyKey.String(orderID),
			attribute.String("messaging.message.id", env.EventID),
			attribute.String("order.event_type", eventType),
		),
	)
	defer span.End()

	var headers []segkafka.Header
	otel.GetTextMapPropagator().Inject(ctx, NewHeaderCarrier(&headers))

	err = p.writer.WriteMessages(ctx, segkafka.Message{
		Topic:   topic,
		Key:     []byte(orderID),
		Value:   body,
		Headers: headers,
	})
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("write message to %s: %w", topic, err)
	}

	metrics.EventsProducedTotal.WithLabelValues(topic, eventType).Inc()
	p.logger.Info("event_produced",
		zap.String("topic", topic),
		zap.String("eventId", env.EventID),
		zap.String("eventType", eventType),
		zap.String("orderId", orderID),
	)
	return nil
}

// Ping verifies broker connectivity for the /readyz handler by dialing the
// first configured broker.
func Ping(ctx context.Context, brokers []string) error {
	if len(brokers) == 0 {
		return errors.New("no kafka brokers configured")
	}
	dialer := &segkafka.Dialer{Timeout: 3 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", brokers[0])
	if err != nil {
		return fmt.Errorf("dial kafka broker %s: %w", brokers[0], err)
	}
	defer conn.Close()
	return nil
}

// EnsureTopics idempotently creates the given topics (if they don't already
// exist) by asking the cluster controller to create them. It retries with
// exponential backoff instead of crashing if the broker isn't up yet.
func EnsureTopics(ctx context.Context, brokers []string, topics []string, logger *zap.Logger) error {
	backoff := time.Second
	const maxBackoff = 30 * time.Second

	for {
		err := createTopicsOnce(ctx, brokers, topics)
		if err == nil {
			logger.Info("kafka topics ensured", zap.Strings("topics", topics))
			return nil
		}

		logger.Warn("failed to ensure kafka topics, retrying",
			zap.Error(err), zap.Duration("backoff", backoff))

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}

		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

func createTopicsOnce(ctx context.Context, brokers []string, topics []string) error {
	if len(brokers) == 0 {
		return errors.New("no kafka brokers configured")
	}

	dialer := &segkafka.Dialer{Timeout: 5 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", brokers[0])
	if err != nil {
		return fmt.Errorf("dial broker %s: %w", brokers[0], err)
	}
	defer conn.Close()

	controller, err := conn.Controller()
	if err != nil {
		return fmt.Errorf("find controller: %w", err)
	}

	controllerAddr := net.JoinHostPort(controller.Host, strconv.Itoa(controller.Port))
	controllerConn, err := dialer.DialContext(ctx, "tcp", controllerAddr)
	if err != nil {
		return fmt.Errorf("dial controller %s: %w", controllerAddr, err)
	}
	defer controllerConn.Close()

	configs := make([]segkafka.TopicConfig, 0, len(topics))
	for _, t := range topics {
		configs = append(configs, segkafka.TopicConfig{
			Topic:             t,
			NumPartitions:     3,
			ReplicationFactor: 1,
		})
	}

	if err := controllerConn.CreateTopics(configs...); err != nil {
		if errors.Is(err, segkafka.TopicAlreadyExists) {
			return nil
		}
		return fmt.Errorf("create topics: %w", err)
	}
	return nil
}
