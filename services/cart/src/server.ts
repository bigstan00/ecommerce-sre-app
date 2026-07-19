import Fastify, { type FastifyInstance } from 'fastify';
import { pinoOptions } from './lib/logger';
import { httpErrorCount, httpRequestCount, httpRequestDuration } from './lib/metrics';
import { cartRoutes } from './routes/cart';
import { healthRoutes } from './routes/health';
import { metricsRoutes } from './routes/metrics';
import { config } from './config';

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: pinoOptions,
  });

  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? req.url;
    const method = req.method;
    const statusCode = String(reply.statusCode);
    const durationSeconds = reply.elapsedTime / 1000;

    httpRequestCount.inc({ method, route, status_code: statusCode });
    httpRequestDuration.observe({ method, route, status_code: statusCode }, durationSeconds);

    if (reply.statusCode >= 500) {
      httpErrorCount.inc({ method, route, status_code: statusCode });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, 'Unhandled error while processing request');
    if (reply.statusCode < 400) {
      reply.status(500);
    }
    return reply.send({ error: 'Internal server error' });
  });

  app.setNotFoundHandler((req, reply) => {
    return reply.status(404).send({ error: `Route ${req.method} ${req.url} not found` });
  });

  app.register(healthRoutes);
  app.register(metricsRoutes);
  app.register(cartRoutes);

  return app;
}

export { config };
