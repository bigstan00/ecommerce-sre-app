import { randomUUID } from 'crypto';
import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import { loggerOptions } from './config/logger';
import { registerMetricsHooks } from './plugins/metricsPlugin';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { HttpError } from './utils/httpErrors';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: loggerOptions,
    disableRequestLogging: false,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  registerMetricsHooks(app);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof HttpError) {
      reply.code(error.statusCode).send({ error: error.code, message: error.message });
      return;
    }

    // Fastify's own schema-validation errors carry a validation array and statusCode 400.
    if (error.validation) {
      request.log.warn({ err: error }, 'request failed validation');
      reply.code(400).send({ error: 'BAD_REQUEST', message: error.message });
      return;
    }

    request.log.error({ err: error }, 'unhandled error');
    reply.code(500).send({ error: 'INTERNAL_SERVER_ERROR', message: 'an unexpected error occurred' });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: 'NOT_FOUND', message: `route not found: ${request.method} ${request.url}` });
  });

  app.register(healthRoutes);
  app.register(authRoutes);

  return app;
}
