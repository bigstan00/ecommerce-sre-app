// aiobs: core observability bootstrap (OpenTelemetry).
//
// Import this FIRST in your entry file, before anything else:
//
//     import './observability';
//
// Auto-instrumentation patches modules (http, ioredis, pg, ...) at require
// time — if they load before this file runs, they never get patched and no
// spans are produced. Import ordering here is load-bearing.
//
// Set these in the service's environment (defaults are fine for local dev):
//     OTEL_SERVICE_NAME=frontend
//     OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
import 'dotenv/config';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// Surface export problems (e.g. unreachable collector) at WARN without noise.
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

const sdk = new NodeSDK({
  // Reads OTEL_EXPORTER_OTLP_ENDPOINT and appends /v1/traces itself.
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [
    getNodeAutoInstrumentations({
      // fs spans are extremely noisy (a span per file read) — off by default.
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

try {
  sdk.start();
} catch (err) {
  // Tracing is additive — a failure here must never take the service down.
  // eslint-disable-next-line no-console
  console.error('[observability] OpenTelemetry SDK failed to initialize', err);
}

const shutdown = (): void => {
  sdk.shutdown().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[observability] error shutting down OpenTelemetry SDK', err);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
