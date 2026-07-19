package eventbus

import (
	"context"
	"fmt"
	"time"

	kafka "github.com/segmentio/kafka-go"
)

// Ping checks Kafka connectivity by dialing the first configured broker.
// Used by the /readyz handler.
func Ping(ctx context.Context, brokers []string) error {
	if len(brokers) == 0 {
		return fmt.Errorf("no kafka brokers configured")
	}

	dialCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	dialer := &kafka.Dialer{Timeout: 3 * time.Second}
	conn, err := dialer.DialContext(dialCtx, "tcp", brokers[0])
	if err != nil {
		return err
	}
	defer conn.Close()

	return nil
}
