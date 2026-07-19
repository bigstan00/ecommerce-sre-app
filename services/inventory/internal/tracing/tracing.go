// Package tracing initializes OpenTelemetry distributed tracing for the
// Inventory service, per Phase 4 of shared/CONTRACTS.md ("distributed
// tracing (OpenTelemetry)"):
//
//   - Exporter protocol: OTLP over HTTP, endpoint from the standard
//     OTEL_EXPORTER_OTLP_ENDPOINT env var (default http://localhost:4318
//     for local dev).
//   - Service name: standard OTEL_SERVICE_NAME env var (default
//     "inventory-service").
//   - Sampling: always-on (100%) — a deliberate practice-app
//     simplification documented in README.md's "Tracing" section, not a
//     production default.
//   - Propagation: W3C Trace Context (the OTel SDK's default propagator),
//     used both for HTTP (via otelhttp) and manually for Kafka headers
//     (see internal/eventbus/carrier.go).
//
// Both env vars are read automatically by the underlying OTel SDK/exporter
// — verified directly against the SDK source in the module cache rather
// than assumed:
//
//   - go.opentelemetry.io/otel/sdk/resource's "fromEnv" resource detector
//     (sdk/resource/env.go) reads OTEL_SERVICE_NAME and is included in the
//     detector chain resource.Default() runs, taking precedence over the
//     SDK's own fallback "unknown_service:<binary>" name.
//   - go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp's
//     New(ctx) (no options) reads OTEL_EXPORTER_OTLP_ENDPOINT directly
//     (see its doc.go); a "http://" scheme in the value (as opposed to
//     "https://") is what disables TLS, so the default value below
//     includes the scheme explicitly.
//
// This package only sets those two env vars to safe local-dev defaults
// when they're unset, then lets the SDK's own env-var detection do the
// rest — it does not hand-roll endpoint/service-name plumbing.
package tracing

import (
	"context"
	"fmt"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/zap"
)

const (
	defaultServiceName      = "inventory-service"
	defaultOTLPHTTPEndpoint = "http://localhost:4318"
)

// Init configures the process-global OTel TracerProvider and TextMapPropagator
// for the Inventory service and returns a shutdown func that flushes and
// closes the exporter (call it during graceful shutdown, alongside the other
// deferred closes in cmd/server/main.go).
//
// If the OTLP endpoint is unreachable, span export failures are routed to
// otel's global error handler, which logs a warning via the provided
// logger — per CONTRACTS.md, tracing must never block or crash the service.
func Init(ctx context.Context, logger *zap.Logger) (func(context.Context) error, error) {
	if os.Getenv("OTEL_SERVICE_NAME") == "" {
		if err := os.Setenv("OTEL_SERVICE_NAME", defaultServiceName); err != nil {
			return nil, fmt.Errorf("set default OTEL_SERVICE_NAME: %w", err)
		}
	}
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" {
		if err := os.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", defaultOTLPHTTPEndpoint); err != nil {
			return nil, fmt.Errorf("set default OTEL_EXPORTER_OTLP_ENDPOINT: %w", err)
		}
	}

	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("build otlp http trace exporter: %w", err)
	}

	// resource.Default() runs the SDK's builtin detector chain, which
	// includes "fromEnv" (reads OTEL_SERVICE_NAME) layered over the
	// fallback default-service-name detector, plus the telemetry-SDK
	// resource attributes (see sdk/resource/builtin.go, env.go).
	res := resource.Default()

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		// 100% sampling: acceptable for this low-traffic practice app;
		// see README.md's "Tracing" section for why this is not a
		// production default.
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		logger.Warn("otel error (span export/propagation issue, non-fatal)", zap.Error(err))
	}))

	logger.Info("otel tracing initialized",
		zap.String("otelServiceName", os.Getenv("OTEL_SERVICE_NAME")),
		zap.String("otelExporterOtlpEndpoint", os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")),
	)

	return tp.Shutdown, nil
}
