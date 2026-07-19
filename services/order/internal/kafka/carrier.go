package kafka

import segkafka "github.com/segmentio/kafka-go"

// HeaderCarrier adapts segmentio/kafka-go's native header list
// ([]kafka.Header, where kafka.Header is {Key string, Value []byte}) to
// OpenTelemetry's propagation.TextMapCarrier interface, per the Kafka
// propagation section of shared/CONTRACTS.md.
//
// It wraps a *[]segkafka.Header (not a plain slice) because Set must be
// able to append a brand-new header — on the producer side the outgoing
// message starts with no traceparent header at all, so Inject needs to
// grow the underlying slice, which requires a pointer to it.
type HeaderCarrier struct {
	headers *[]segkafka.Header
}

// NewHeaderCarrier builds a HeaderCarrier wrapping headers. Pass the
// address of a kafka.Message's Headers field (or a local []kafka.Header
// destined for one) on the producer side, and the address of an
// already-received message's Headers field on the consumer side.
func NewHeaderCarrier(headers *[]segkafka.Header) HeaderCarrier {
	return HeaderCarrier{headers: headers}
}

// Get returns the string value of the header named key, or "" if absent.
// Per the W3C traceparent contract, header values are UTF-8-encoded
// strings stored as the byte value of a Kafka header.
func (c HeaderCarrier) Get(key string) string {
	for _, h := range *c.headers {
		if h.Key == key {
			return string(h.Value)
		}
	}
	return ""
}

// Set stores key=value, overwriting any existing header with the same key
// in place, or appending a new one if key isn't already present.
func (c HeaderCarrier) Set(key, value string) {
	for i, h := range *c.headers {
		if h.Key == key {
			(*c.headers)[i].Value = []byte(value)
			return
		}
	}
	*c.headers = append(*c.headers, segkafka.Header{Key: key, Value: []byte(value)})
}

// Keys lists every header key currently stored in the carrier.
func (c HeaderCarrier) Keys() []string {
	keys := make([]string, 0, len(*c.headers))
	for _, h := range *c.headers {
		keys = append(keys, h.Key)
	}
	return keys
}
