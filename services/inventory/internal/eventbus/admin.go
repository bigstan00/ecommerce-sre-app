package eventbus

import (
	"context"
	"fmt"
	"net"
	"strconv"
	"time"

	kafka "github.com/segmentio/kafka-go"
	"go.uber.org/zap"
)

// EnsureTopics idempotently creates the given topics (kafka-go's
// Conn.CreateTopics already treats "topic already exists" as a no-op), with
// retry-with-backoff so a slow-starting broker doesn't crash the service.
func EnsureTopics(ctx context.Context, brokers []string, topics []string, logger *zap.Logger) error {
	if len(brokers) == 0 {
		return fmt.Errorf("no kafka brokers configured")
	}

	backoff := time.Second
	const maxBackoff = 30 * time.Second
	const maxAttempts = 15

	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}

		lastErr = createTopics(ctx, brokers[0], topics)
		if lastErr == nil {
			logger.Info("kafka topics ensured", zap.Strings("topics", topics))
			return nil
		}

		logger.Warn("failed to create kafka topics, retrying",
			zap.Error(lastErr),
			zap.Int("attempt", attempt),
			zap.Duration("backoff", backoff),
		)

		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return ctx.Err()
		}

		if backoff < maxBackoff {
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}

	return fmt.Errorf("failed to create kafka topics after %d attempts: %w", maxAttempts, lastErr)
}

func createTopics(ctx context.Context, broker string, topics []string) error {
	dialer := &kafka.Dialer{Timeout: 5 * time.Second}

	conn, err := dialer.DialContext(ctx, "tcp", broker)
	if err != nil {
		return fmt.Errorf("dial broker: %w", err)
	}
	defer conn.Close()

	controller, err := conn.Controller()
	if err != nil {
		return fmt.Errorf("find controller: %w", err)
	}

	controllerAddr := net.JoinHostPort(controller.Host, strconv.Itoa(controller.Port))
	controllerConn, err := dialer.DialContext(ctx, "tcp", controllerAddr)
	if err != nil {
		return fmt.Errorf("dial controller: %w", err)
	}
	defer controllerConn.Close()

	configs := make([]kafka.TopicConfig, 0, len(topics))
	for _, t := range topics {
		configs = append(configs, kafka.TopicConfig{
			Topic:             t,
			NumPartitions:     1,
			ReplicationFactor: 1,
		})
	}

	if err := controllerConn.CreateTopics(configs...); err != nil {
		return fmt.Errorf("create topics: %w", err)
	}

	return nil
}
