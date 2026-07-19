import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../config/logger';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // Errors on idle clients — log but don't crash the process.
  logger.error({ err }, 'unexpected error on idle postgres client');
});

/**
 * Lightweight connectivity check used by /readyz. Must resolve quickly and
 * never throw an unhandled rejection — callers are expected to catch.
 */
export async function pingDatabase(): Promise<void> {
  await pool.query('SELECT 1');
}
