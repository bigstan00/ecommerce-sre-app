import type { FastifyInstance } from 'fastify';
import { registry } from '../lib/metrics';

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return reply.status(200).send(await registry.metrics());
  });
}
