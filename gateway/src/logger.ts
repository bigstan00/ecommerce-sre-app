import pino from 'pino';

/**
 * Structured JSON logs to stdout, one JSON object per line, with the fields
 * required by CONTRACTS.md: timestamp, level, service, message, plus context.
 *
 * Pino's defaults use "time" (epoch ms) and "msg" — both are remapped below
 * so every log line matches the contract exactly.
 */
export function createLogger(logLevel: string) {
  return pino({
    level: logLevel,
    base: { service: 'gateway' },
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
