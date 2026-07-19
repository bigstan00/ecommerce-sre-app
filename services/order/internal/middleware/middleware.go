// Package middleware provides HTTP middleware for request logging and
// Prometheus instrumentation shared across all Order routes.
package middleware

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"

	"order/internal/metrics"
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
