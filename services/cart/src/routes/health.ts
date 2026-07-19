import type { FastifyInstance } from 'fastify';
import { redisClient } from '../lib/redisClient';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness: no dependency checks, just confirms the process is up.
  app.get('/healthz', async (_req, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  // Readiness: must actually check Redis connectivity.
  app.get('/readyz', async (_req, reply) => {
    const redisOk = await redisClient.ping();

    if (!redisOk) {
      return reply.status(503).send({ status: 'not-ready', reason: 'redis unreachable' });
    }

    return reply.status(200).send({ status: 'ready' });
  });
}
