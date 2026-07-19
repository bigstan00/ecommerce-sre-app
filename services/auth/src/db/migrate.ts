import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../config/logger';

/**
 * Minimal, dependency-free migration runner: applies every .sql file in
 * migrations/ in filename order, tracked in a schema_migrations table so
 * re-running is a no-op. Good enough for a learning project; a real system
 * would use a proper migration tool.
 */
async function migrate(): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const migrationsDir = join(__dirname, '..', '..', 'migrations');

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
      if (rows.length > 0) {
        logger.info({ file }, 'migration already applied, skipping');
        continue;
      }

      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      logger.info({ file }, 'applying migration');
      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await pool.query('COMMIT');
      } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
      }
    }

    logger.info('all migrations applied');
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  logger.error({ err }, 'migration failed');
  process.exit(1);
});
