// Package tracing initializes OpenTelemetry distributed tracing for the
// Order service, per the "Phase 4: distributed tracing" section of
// shared/CONTRACTS.md.
//
// Conventions implemented here (all from CONTRACTS.md, not invented):
//   - Exporter protocol: OTLP over HTTP, reading the endpoint from the
//     standard OTEL_EXPORTER_OTLP_ENDPOINT env var (default
//     http://localhost:4318 for local dev if unset).
//   - Service name: standard OTEL_SERVICE_NAME env var (default
//     "order-service" if unset).
//   - Sampling: always-on (100%) — a deliberate simplification for this
//     low-traffic practice app, not a production default.
//   - Propagation format: W3C Trace Context, via the SDK's built-in
//     propagator (propagation.TraceContext) — no custom scheme.
//
// Both OTEL_SERVICE_NAME and OTEL_EXPORTER_OTLP_ENDPOINT are standard,
// spec-defined env vars that the SDK already knows how to read on its own
// (resource.WithFromEnv() reads OTEL_SERVICE_NAME; otlptracehttp.New reads
// OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_TRACES_ENDPOINT). This
// package only seeds process defaults for the two vars when unset so the
// SDK's own env-reading logic picks up this service's documented defaults
// without needing any explicit WithEndpoint/WithServiceName option calls.
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
	defaultServiceName  = "order-service"
	defaultOTLPEndpoint = "http://localhost:4318"

	otelServiceNameEnv  = "OTEL_SERVICE_NAME"
	otelOTLPEndpointEnv = "OTEL_EXPORTER_OTLP_ENDPOINT"
)

// Shutdown flushes and stops the tracer provider. Callers should invoke it
// during graceful shutdown, with a bounded-timeout context.
type Shutdown func(ctx context.Context) error

// Init sets up the global OTel TracerProvider and W3C Trace Context
// propagator for the process. It is additive instrumentation: per
// CONTRACTS.md, if the OTLP endpoint is unreachable, spans are dropped and
// export errors are logged as warnings — this must never block startup or
// crash the service, so Init itself only fails on genuine local
// misconfiguration (e.g. a malformed endpoint URL), not on the collector
// being down (export happens asynchronously, after Init returns).
func Init(ctx context.Context, logger *zap.Logger) (Shutdown, error) {
	// Seed documented defaults for the two standard env vars this service
	// reads, per CONTRACTS.md, before the SDK's own env detectors run.
	if os.Getenv(otelServiceNameEnv) == "" {
		_ = os.Setenv(otelServiceNameEnv, defaultServiceName)
	}
	if os.Getenv(otelOTLPEndpointEnv) == "" {
		_ = os.Setenv(otelOTLPEndpointEnv, defaultOTLPEndpoint)
	}

	// Route the SDK's internal error handler (used for async export
	// failures, e.g. an unreachable collector) through our structured
	// logger instead of the default stderr writer, at warn level per
	// CONTRACTS.md ("logged as a warning, never block or crash").
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		logger.Warn("otel export error", zap.Error(err))
	}))

	res, err := resource.New(ctx,
		resource.WithFromEnv(),      // OTEL_SERVICE_NAME / OTEL_RESOURCE_ATTRIBUTES
		resource.WithTelemetrySDK(), // telemetry.sdk.{name,language,version}
		resource.WithHost(),         // host.name
	)
	if err != nil {
		return nil, fmt.Errorf("build otel resource: %w", err)
	}

	// otlptracehttp.New reads OTEL_EXPORTER_OTLP_ENDPOINT (and
	// OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, which takes precedence) itself;
	// no WithEndpoint option is passed here so the standard env var stays
	// authoritative, per CONTRACTS.md. An http:// (not https://) scheme in
	// the endpoint is auto-detected by the SDK as an insecure connection.
	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("build otlp http exporter: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})

	logger.Info("otel tracing initialized",
		zap.String("serviceName", os.Getenv(otelServiceNameEnv)),
		zap.String("otlpEndpoint", os.Getenv(otelOTLPEndpointEnv)),
		zap.String("sampler", "always_on"),
	)

	return tp.Shutdown, nil
}
