import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../config';
import { registry } from '../metrics';

interface DependencyCheck {
  name: string;
  url: string;
}

async function checkDependency(check: DependencyCheck, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetch(`${check.url}/healthz`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return `${check.name} responded with status ${response.status}`;
    }
    return null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown error';
    return `${check.name} unreachable: ${reason}`;
  }
}

/**
 * Gateway's own liveness/readiness/metrics endpoints (CONTRACTS.md
 * cross-cutting conventions). The gateway has no database of its own, so
 * readiness is defined as "can reach every upstream it proxies to."
 */
const healthRoutes: FastifyPluginAsync<{ config: AppConfig }> = async (fastify, opts) => {
  // rateLimit: false opts these three routes out of the global rate limiter
  // registered in app.ts entirely. This is the mechanism that actually
  // works — `allowList` on the rate-limit plugin filters by *client key*
  // (IP by default), not by URL path, so it can't be used to exempt a route.
  fastify.get('/healthz', { config: { rateLimit: false } }, async () => {
    return { status: 'ok' };
  });

  fastify.get('/readyz', { config: { rateLimit: false } }, async (_request, reply) => {
    const checks: DependencyCheck[] = [
      { name: 'auth', url: opts.config.authServiceUrl },
      { name: 'catalog', url: opts.config.catalogServiceUrl },
      { name: 'cart', url: opts.config.cartServiceUrl },
      { name: 'order', url: opts.config.orderServiceUrl },
    ];

    const results = await Promise.all(
      checks.map((check) => checkDependency(check, opts.config.readinessTimeoutMs)),
    );
    const failures = results.filter((result): result is string => result !== null);

    if (failures.length > 0) {
      return reply.code(503).send({ status: 'not-ready', reason: failures.join('; ') });
    }

    return { status: 'ready' };
  });

  fastify.get('/metrics', { config: { rateLimit: false } }, async (_request, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });
};

export default healthRoutes;
