package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.uber.org/zap"

	"order/internal/middleware"
)

// NewRouter builds the chi router with all Order routes wired up, including
// health/readiness/metrics endpoints and request instrumentation.
func NewRouter(h *Handler, logger *zap.Logger) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.Instrumentation(logger))

	r.Get("/healthz", h.Healthz)
	r.Get("/readyz", h.Readyz)
	r.Handle("/metrics", promhttp.Handler())

	// otelhttp instruments only the synchronous business-logic routes per
	// shared/CONTRACTS.md (health/readiness/metrics are excluded — they're
	// not part of any distributed trace and scraped/polled far too often
	// to be worth tracing). This auto-instrumentation is what extracts an
	// inbound traceparent header from the gateway (if present) and starts
	// the server span that POST /orders' order.created publish, and every
	// downstream Kafka hop, ultimately descends from.
	r.Group(func(r chi.Router) {
		r.Use(otelhttp.NewMiddleware("order-service", otelhttp.WithSpanNameFormatter(spanName)))

		r.Post("/orders", h.CreateOrder)
		r.Get("/orders", h.ListOrders)
		r.Get("/orders/{id}", h.GetOrder)

		r.Get("/admin/orders", h.ListOrdersAdmin)
	})

	return r
}

// spanName names HTTP server spans "<method> <route pattern>" (e.g.
// "GET /orders/{id}") instead of otelhttp's default of just the bare
// operation string, following OTel HTTP semantic conventions. chi has
// already resolved the route pattern onto the request context by the time
// this middleware runs, since routing happens before the middleware chain
// executes.
func spanName(_ string, r *http.Request) string {
	if rctx := chi.RouteContext(r.Context()); rctx != nil {
		if pattern := rctx.RoutePattern(); pattern != "" {
			return r.Method + " " + pattern
		}
	}
	return r.Method + " " + r.URL.Path
}
