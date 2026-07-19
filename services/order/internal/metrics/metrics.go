// Package metrics defines the Prometheus collectors exposed at GET /metrics.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// RequestsTotal counts every HTTP request handled by the service,
	// labeled by method, route pattern, and status code.
	RequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "order_http_requests_total",
			Help: "Total number of HTTP requests processed by the order service.",
		},
		[]string{"method", "route", "status"},
	)

	// RequestDuration observes request handling latency in seconds,
	// labeled by method and route pattern.
	RequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "order_http_request_duration_seconds",
			Help:    "Histogram of HTTP request durations in seconds.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "route"},
	)

	// ErrorsTotal counts requests that resulted in a 5xx (or handler-level
	// error) response, labeled by method and route pattern.
	ErrorsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "order_http_errors_total",
			Help: "Total number of HTTP requests that resulted in an error response.",
		},
		[]string{"method", "route", "status"},
	)

	// EventsProducedTotal counts Kafka events published, labeled by topic.
	EventsProducedTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "order_kafka_events_produced_total",
			Help: "Total number of Kafka events published by the order service.",
		},
		[]string{"topic", "eventType"},
	)

	// EventsConsumedTotal counts Kafka events consumed, labeled by topic.
	EventsConsumedTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "order_kafka_events_consumed_total",
			Help: "Total number of Kafka events consumed by the order service.",
		},
		[]string{"topic", "eventType"},
	)
)
