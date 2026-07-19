package eventbus

import (
	kafka "github.com/segmentio/kafka-go"
)

// KafkaHeaderCarrier adapts a Kafka message's native header list to
// propagation.TextMapCarrier, per the "Kafka propagation" section of
// shared/CONTRACTS.md's Phase 4. It wraps a *[]kafka.Header (rather than a
// plain []kafka.Header) so Set can append a new header to the caller's
// slice on inject.
//
// Header key used for trace context: "traceparent" (W3C Trace Context
// format), written by the OTel propagator's Inject and read back by its
// Extract — this type only adapts kafka-go's header shape, it doesn't know
// or care about the header's name or value format itself.
type KafkaHeaderCarrier struct {
	Headers *[]kafka.Header
}

// Get returns the value of the first header matching key, or "" if absent.
func (c KafkaHeaderCarrier) Get(key string) string {
	for _, h := range *c.Headers {
		if h.Key == key {
			return string(h.Value)
		}
	}
	return ""
}

// Set writes key=value, replacing an existing header with the same key if
// present (mirrors HTTP header semantics, which the W3C propagator expects)
// or appending a new one otherwise.
func (c KafkaHeaderCarrier) Set(key, value string) {
	for i, h := range *c.Headers {
		if h.Key == key {
			(*c.Headers)[i].Value = []byte(value)
			return
		}
	}
	*c.Headers = append(*c.Headers, kafka.Header{Key: key, Value: []byte(value)})
}

// Keys returns every header key currently set.
func (c KafkaHeaderCarrier) Keys() []string {
	keys := make([]string, 0, len(*c.Headers))
	for _, h := range *c.Headers {
		keys = append(keys, h.Key)
	}
	return keys
}
