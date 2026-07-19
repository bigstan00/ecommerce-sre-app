package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.uber.org/zap"

	"catalog/internal/middleware"
)

// NewRouter builds the chi router with all Catalog routes wired up,
// including health/readiness/metrics endpoints and request instrumentation.
func NewRouter(h *Handler, logger *zap.Logger) http.Handler {
	r := chi.NewRouter()

	// otelhttp gives every request a server span with automatic W3C
	// traceparent extraction from incoming request headers -- this is what
	// lets a trace started upstream (e.g. at the Gateway) continue into
	// Catalog. Registered as the outermost middleware so the span covers
	// the full request lifecycle, including the Instrumentation
	// middleware's logging/metrics work.
	//
	// chi middlewares wrap chi's own route-matching step (mx.handler =
	// chain(mx.middlewares, mx.routeHTTP)), so at the moment otelhttp
	// creates this span the request hasn't been routed yet and
	// chi.RouteContext(r.Context()).RoutePattern() is still empty --
	// naming the span here would degrade to the raw, high-cardinality URL
	// path (e.g. a distinct span name per product ID). Instead we let
	// otelhttp assign its default name up front and have the
	// Instrumentation middleware below rename/tag the span with the
	// matched route pattern once chi has actually resolved it (it already
	// reads RoutePattern() the same way, after calling next.ServeHTTP).
	r.Use(otelhttp.NewMiddleware("catalog-service"))

	r.Use(middleware.Instrumentation(logger))

	r.Get("/healthz", h.Healthz)
	r.Get("/readyz", h.Readyz)
	r.Handle("/metrics", promhttp.Handler())

	r.Get("/products", h.ListProducts)
	r.Get("/products/{id}", h.GetProduct)
	r.Post("/products", h.CreateProduct)
	r.Get("/categories", h.ListCategories)

	return r
}
