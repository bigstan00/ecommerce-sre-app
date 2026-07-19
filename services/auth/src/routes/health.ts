import type { FastifyInstance } from 'fastify';
import { pingDatabase } from '../db/pool';
import { renderMetrics } from '../utils/metrics';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness: no dependency checks, just "is the process up".
  app.get('/healthz', async (_request, reply) => {
    reply.code(200).send({ status: 'ok' });
  });

  // Readiness: must actually check downstream dependency connectivity (Postgres).
  app.get('/readyz', async (_request, reply) => {
    try {
      await pingDatabase();
      reply.code(200).send({ status: 'ready' });
    } catch (err) {
      app.log.warn({ err }, 'readiness check failed: database unreachable');
      reply.code(503).send({ status: 'not-ready', reason: 'database unreachable' });
    }
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8').send(renderMetrics());
  });
}
