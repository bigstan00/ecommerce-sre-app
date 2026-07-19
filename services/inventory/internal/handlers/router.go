package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.uber.org/zap"

	"inventory/internal/middleware"
)

// NewRouter builds the chi router with all Inventory routes wired up,
// including health/readiness/metrics endpoints and request instrumentation.
//
// Per shared/CONTRACTS.md's Phase 4, the synchronous business routes
// (GET/POST /inventory, GET /inventory/:productId) are each wrapped with
// otelhttp so the W3C traceparent HTTP header is auto-extracted/injected —
// no manual span code needed for these hops. Health/readiness/metrics
// endpoints are intentionally left unwrapped; they aren't part of any
// business trace.
func NewRouter(h *Handler, logger *zap.Logger) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.Instrumentation(logger))

	r.Get("/healthz", h.Healthz)
	r.Get("/readyz", h.Readyz)
	r.Handle("/metrics", promhttp.Handler())

	r.Method(http.MethodGet, "/inventory", otelhttp.NewHandler(http.HandlerFunc(h.ListStock), "GET /inventory"))
	r.Method(http.MethodGet, "/inventory/{productId}", otelhttp.NewHandler(http.HandlerFunc(h.GetStock), "GET /inventory/{productId}"))
	r.Method(http.MethodPost, "/inventory", otelhttp.NewHandler(http.HandlerFunc(h.UpsertStock), "POST /inventory"))

	return r
}
