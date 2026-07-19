import pino, { type LoggerOptions } from 'pino';
import { config } from './index';

/**
 * Shared pino options so every logger in the process (Fastify's internal
 * per-request logger, and this standalone instance used outside request
 * scope) emits the same structured shape: one JSON object per line with
 * timestamp, level, service, message, plus context fields.
 */
export const loggerOptions: LoggerOptions = {
  level: config.logLevel,
  base: { service: config.service },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  messageKey: 'message',
};

/**
 * Standalone logger for use outside of a Fastify request lifecycle
 * (startup, shutdown, the DB pool, the migration runner). Fastify itself is
 * configured with `loggerOptions` directly rather than this instance, to
 * avoid TypeScript narrowing FastifyInstance's logger generic to a concrete
 * pino.Logger type.
 */
export const logger = pino(loggerOptions);
