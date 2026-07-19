// Package tracing wires up OpenTelemetry distributed tracing for the
// Catalog service: SDK initialization, the OTLP/HTTP exporter, and W3C
// Trace Context propagation. See shared/CONTRACTS.md's "Phase 4:
// distributed tracing" section for the cross-service conventions this
// package implements.
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
	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"
	"go.uber.org/zap"
)

// defaultServiceName is used for the "service.name" resource attribute
// when OTEL_SERVICE_NAME is unset, per shared/CONTRACTS.md's per-service
// default for Catalog.
const defaultServiceName = "catalog-service"

// Shutdown flushes buffered spans and stops the tracer provider. Callers
// should invoke it (with a bounded context) during graceful shutdown.
type Shutdown func(context.Context) error

// Init configures the global OTel TracerProvider with an OTLP/HTTP
// exporter and W3C Trace Context propagation, then returns a Shutdown
// func for graceful teardown.
//
// Env var handling -- verified against the installed Go SDK source
// (go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp and
// go.opentelemetry.io/otel/sdk/resource), not assumed by analogy with the
// Node SDK:
//
//   - OTEL_EXPORTER_OTLP_ENDPOINT is read automatically. otlptracehttp.New
//     applies otlpconfig.ApplyHTTPEnvConfigs internally, which reads
//     OTEL_EXPORTER_OTLP_ENDPOINT (and the more specific
//     OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) via the OTEL_EXPORTER_OTLP_*
//     namespace -- no manual flag-wiring needed. If unset, the exporter's
//     own built-in default is http://localhost:4318, matching
//     CONTRACTS.md's documented default exactly.
//   - OTEL_SERVICE_NAME is ALSO read automatically, but only implicitly:
//     go.opentelemetry.io/otel/sdk/resource ships a "fromEnv" Detector
//     that reads OTEL_SERVICE_NAME, and it's included in resource.Default().
//     The catch is that resource.Default()'s own fallback when the env var
//     is unset is "unknown_service:<binary>", not this service's
//     documented default of "catalog-service". So instead of relying on
//     resource.Default(), we build the resource explicitly: seed it with
//     our own default service name first, then layer resource.WithFromEnv()
//     on top. Per resource.Merge's documented semantics ("b" overwrites "a"
//     on conflicting keys) and fromEnv's own implementation (it returns an
//     empty Resource -- no overwrite -- when OTEL_SERVICE_NAME is unset),
//     this gives us exactly: env var wins when set, "catalog-service"
//     otherwise.
func Init(ctx context.Context, logger *zap.Logger) (Shutdown, error) {
	res, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceNameKey.String(defaultServiceName)),
		resource.WithFromEnv(), // overwrites service.name if OTEL_SERVICE_NAME is set
		resource.WithTelemetrySDK(),
		resource.WithSchemaURL(semconv.SchemaURL),
	)
	if err != nil {
		return nil, fmt.Errorf("building otel resource: %w", err)
	}

	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("creating otlp/http trace exporter: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		// Always-on (100%) sampling is a deliberate simplification for
		// this low-traffic practice app -- NOT a production default. Real
		// systems sample well below 100% to control cost/volume. See the
		// README's "Tracing" section.
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)

	otel.SetTracerProvider(tp)

	// W3C Trace Context is already the OTel SDK's default propagator; set
	// it explicitly so incoming/outgoing "traceparent" propagation via
	// otelhttp doesn't silently depend on that default never changing.
	otel.SetTextMapPropagator(propagation.TraceContext{})

	// Route internal OTel errors (e.g. the OTLP endpoint being unreachable)
	// through the service's structured logger as warnings instead of
	// letting them crash or block anything -- exporting is best-effort and
	// must never take the service down.
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		logger.Warn("otel error", zap.Error(err))
	}))

	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		endpoint = "http://localhost:4318 (default, OTEL_EXPORTER_OTLP_ENDPOINT unset)"
	}
	serviceName := os.Getenv("OTEL_SERVICE_NAME")
	if serviceName == "" {
		serviceName = defaultServiceName + " (default, OTEL_SERVICE_NAME unset)"
	}
	logger.Info("otel tracing initialized",
		zap.String("exporterEndpoint", endpoint),
		zap.String("serviceName", serviceName),
		zap.String("sampling", "always-on (100%) - practice-app simplification, not production default"),
	)

	return tp.Shutdown, nil
}
