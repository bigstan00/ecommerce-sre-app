// Package middleware provides HTTP middleware for request logging and
// Prometheus instrumentation shared across all Catalog routes.
package middleware

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"catalog/internal/metrics"
)

// statusRecorder wraps http.ResponseWriter to capture the status code
// written by downstream handlers, defaulting to 200 if WriteHeader is
// never called explicitly.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Instrumentation returns middleware that logs each request as structured
// JSON and records Prometheus request count / duration / error metrics.
func Instrumentation(logger *zap.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(rec, r)

			duration := time.Since(start)
			route := chi.RouteContext(r.Context()).RoutePattern()
			if route == "" {
				route = r.URL.Path
			}
			status := strconv.Itoa(rec.status)

			// The otelhttp middleware (registered outside/before this one,
			// see internal/handlers/router.go) creates the request's server
			// span before chi has matched a route, so it can't name the
			// span using the route pattern yet. Now that routing has
			// happened (chi middlewares wrap chi's own route-matching
			// step), rename/tag the active span with the low-cardinality
			// route pattern instead of the raw URL path.
			if span := trace.SpanFromContext(r.Context()); span.SpanContext().IsValid() {
				span.SetName(r.Method + " " + route)
				span.SetAttributes(attribute.String("http.route", route))
			}

			metrics.RequestsTotal.WithLabelValues(r.Method, route, status).Inc()
			metrics.RequestDuration.WithLabelValues(r.Method, route).Observe(duration.Seconds())
			if rec.status >= 500 {
				metrics.ErrorsTotal.WithLabelValues(r.Method, route, status).Inc()
			}

			logger.Info("http_request",
				zap.String("method", r.Method),
				zap.String("path", r.URL.Path),
				zap.String("route", route),
				zap.Int("status", rec.status),
				zap.Duration("duration", duration),
				zap.String("remoteAddr", r.RemoteAddr),
			)
		})
	}
}
