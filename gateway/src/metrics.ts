import client from 'prom-client';

/**
 * Prometheus metrics for the gateway itself. Broken down by "upstream" —
 * the logical service the request was routed to (auth/catalog/cart/order/gateway)
 * — rather than raw URL, to avoid unbounded cardinality from path params
 * like /api/cart/items/:productId.
 */

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'gateway_' });

export const httpRequestsTotal = new client.Counter({
  name: 'gateway_http_requests_total',
  help: 'Total number of HTTP requests handled by the gateway',
  labelNames: ['method', 'upstream', 'route', 'status_code'] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'gateway_http_request_duration_seconds',
  help: 'HTTP request duration in seconds, as observed by the gateway',
  labelNames: ['method', 'upstream', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpRequestErrorsTotal = new client.Counter({
  name: 'gateway_http_request_errors_total',
  help: 'Total number of HTTP requests that resulted in an error response (status >= 500) or gateway-level failure',
  labelNames: ['method', 'upstream', 'route', 'status_code'] as const,
  registers: [registry],
});

export const rateLimitExceededTotal = new client.Counter({
  name: 'gateway_rate_limit_exceeded_total',
  help: 'Total number of requests rejected because a rate limit was exceeded',
  labelNames: ['upstream', 'limiter'] as const,
  registers: [registry],
});

const UPSTREAM_PREFIXES: Array<{ prefix: string; upstream: string }> = [
  { prefix: '/api/auth', upstream: 'auth' },
  { prefix: '/api/products', upstream: 'catalog' },
  { prefix: '/api/categories', upstream: 'catalog' },
  { prefix: '/api/cart', upstream: 'cart' },
  { prefix: '/api/orders', upstream: 'order' },
];

/** Classifies a request path into the logical upstream it was routed to. */
export function classifyUpstream(url: string): string {
  const match = UPSTREAM_PREFIXES.find(({ prefix }) => url.startsWith(prefix));
  return match?.upstream ?? 'gateway';
}
