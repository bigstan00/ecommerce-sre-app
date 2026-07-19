import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpRequestCount = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests received',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const httpErrorCount = new client.Counter({
  name: 'http_errors_total',
  help: 'Total number of HTTP requests that resulted in an error (status >= 500)',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});
