import './tracing';
import { buildServer, config } from './server';
import { redisClient } from './lib/redisClient';
import { logger } from './lib/logger';

async function main(): Promise<void> {
  // Connect in the background rather than awaiting here: the Redis client's
  // reconnect strategy retries indefinitely on failure and never rejects,
  // so awaiting it would block the HTTP server (and /healthz) from ever
  // coming up while Redis is unavailable. /readyz reflects real connectivity
  // via an actual ping, independent of this.
  redisClient.connect().catch((err) => {
    logger.error({ err }, 'Initial Redis connection failed, will keep retrying in the background');
  });

  const app = buildServer();

  try {
    await app.listen({ host: '0.0.0.0', port: config.port });
    logger.info({ port: config.port }, 'Cart service listening');
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down gracefully');
    try {
      await app.close();
      await redisClient.disconnect();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error during startup');
  process.exit(1);
});
