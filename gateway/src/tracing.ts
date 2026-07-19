// OpenTelemetry bootstrap — Phase 4 (see shared/CONTRACTS.md, "Phase 4:
// distributed tracing").
//
// This module MUST be the very first thing imported by src/index.ts, before
// any other import (including './app', './config', fastify,
// @fastify/http-proxy, ioredis, etc). Auto-instrumentation works by
// monkey-patching modules (http, https, ioredis, ...) at `require()` time —
// if those modules get required before this file registers the
// instrumentations below, they never get patched and no spans are produced.
// Import ordering here is load-bearing, not stylistic.
//
// `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME` are standard OTel
// env vars — the SDK and exporter read them automatically. Nothing in this
// file needs to reference them directly. Defaults for local dev
// (http://localhost:4318, gateway) live in .env.example.
import 'dotenv/config';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// Route OTel's internal diagnostics (e.g. "OTLP endpoint unreachable") to
// stderr at WARN so export failures are visible without being noisy. Per
// CONTRACTS.md, a dropped export must never block or crash the service —
// the exporter already handles that; this just makes failures observable.
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

const sdk = new NodeSDK({
  // Reads OTEL_EXPORTER_OTLP_ENDPOINT and appends the standard /v1/traces
  // path itself; no manual config needed.
  traceExporter: new OTLPTraceExporter(),
  // Auto-instruments HTTP server/client — including the gateway's proxying
  // of /api/* to Auth/Catalog/Cart/Order via @fastify/http-proxy, which is
  // built on Node's http/https under the hood — plus the ioredis client
  // used for shared rate-limit counters. No manual span code. `fs`
  // instrumentation is disabled because it's extremely noisy (every file
  // read/write becomes a span) and isn't one of the integrations
  // CONTRACTS.md calls out for this service.
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

try {
  sdk.start();
} catch (err) {
  // Tracing is additive instrumentation, never a startup dependency (see
  // CONTRACTS.md Phase 4: "spans should be dropped/logged as a warning,
  // never block or crash the service"). Fall back to plain stderr here
  // since the structured pino logger isn't initialized this early.
  // eslint-disable-next-line no-console
  console.error('[tracing] OpenTelemetry SDK failed to initialize', err);
}

const shutdown = (): void => {
  sdk.shutdown().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[tracing] error shutting down OpenTelemetry SDK', err);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
