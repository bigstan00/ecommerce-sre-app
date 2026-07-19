import type { FastifyInstance } from 'fastify';
import { httpErrorsTotal, httpRequestDurationSeconds, httpRequestsTotal } from '../utils/metrics';

/**
 * Records request count / duration / error count for every request.
 * Uses the matched route pattern (not the raw URL) as the label so
 * cardinality stays bounded regardless of path params.
 */
export function registerMetricsHooks(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url ?? request.url;
    const method = request.method;
    const statusCode = String(reply.statusCode);
    const durationSeconds = reply.elapsedTime / 1000;

    const labels = { method, route, status_code: statusCode };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSeconds);
    if (reply.statusCode >= 400) {
      httpErrorsTotal.inc(labels);
    }
  });
}
