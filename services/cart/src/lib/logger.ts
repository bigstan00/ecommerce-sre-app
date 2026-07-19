import pino from 'pino';
import { config } from '../config';

/**
 * Standalone structured logger for use outside the request lifecycle
 * (startup, shutdown, background tasks). Request-scoped logging is
 * handled by Fastify's built-in pino instance (see server.ts), which
 * is configured with the same base fields.
 */
export const pinoOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: config.serviceName },
  timestamp: pino.stdTimeFunctions.isoTime,
  messageKey: 'message',
  formatters: {
    level(label) {
      return { level: label };
    },
  },
};

export const logger = pino(pinoOptions);

