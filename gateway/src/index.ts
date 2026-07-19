import './tracing';
import 'dotenv/config';
import { buildApp } from './app';
import { assertRateLimitInvariants, loadConfig } from './config';
import { createLogger } from './logger';

function main(): void {
  // Logger is created before config validation so even startup/config
  // errors go out as structured JSON, never console.log/console.error.
  const bootLogger = createLogger(process.env.LOG_LEVEL ?? 'info');

  let config;
  try {
    config = loadConfig();
    assertRateLimitInvariants(config);
  } catch (err) {
    bootLogger.fatal({ err }, 'gateway failed to start: invalid configuration');
    process.exit(1);
    return;
  }

  const logger = createLogger(config.logLevel);
  const app = buildApp(config, logger);

  app.listen({ port: config.port, host: '0.0.0.0' }, (err) => {
    if (err) {
      logger.fatal({ err }, 'failed to start gateway');
      process.exit(1);
    }
    logger.info({ port: config.port }, 'gateway listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down gateway');
    app
      .close()
      .then(() => {
        logger.info('gateway shut down cleanly');
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error({ err }, 'error during shutdown');
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
