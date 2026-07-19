import './tracing';
import { buildApp } from './app';
import { config } from './config';
import { logger } from './config/logger';
import { pool } from './db/pool';

async function main(): Promise<void> {
  const app = buildApp();

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info({ port: config.port }, 'auth service listening');
  } catch (err) {
    logger.error({ err }, 'failed to start auth service');
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
      await pool.end();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal error during startup');
  process.exit(1);
});
