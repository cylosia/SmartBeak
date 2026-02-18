import type { Knex } from 'knex';
import { SqlMigrationSource } from './migrations/SqlMigrationSource.js';

/**
 * Knex configuration for database migrations.
 *
 * Usage:
 *   tsx scripts/migrate.ts <command>
 *
 * Connection: reads CONTROL_PLANE_DB environment variable.
 * Tracking table: schema_migrations
 */

function getBaseConfig(): Knex.Config {
  const connectionString = process.env['CONTROL_PLANE_DB'];
  if (!connectionString) {
    throw new Error(
      'CONTROL_PLANE_DB environment variable is required. ' +
      'Set it to your PostgreSQL connection string.'
    );
  }

  // FIX P2-09: Enable SSL in all environments except explicit test runs.
  // This prevents accidental unencrypted traffic if NODE_ENV is not set.
  const isTest = process.env['NODE_ENV'] === 'test';
  const sslConfig = isTest ? false : { rejectUnauthorized: true };

  return {
    client: 'postgresql',
    connection: {
      connectionString,
      ssl: sslConfig,
    },
    pool: { min: 1, max: 5 },
    migrations: {
      tableName: 'schema_migrations',
      migrationSource: new SqlMigrationSource(),
    },
  };
}

const config: Record<string, Knex.Config> = {
  development: getBaseConfig(),

  production: {
    ...getBaseConfig(),
    connection: {
      connectionString: process.env['CONTROL_PLANE_DB'],
      // FIX P1-08: Hard-code rejectUnauthorized: true in production.
      // DB_SSL_REJECT_UNAUTHORIZED is intentionally NOT consulted here.
      // Disabling certificate verification opens the production database to
      // man-in-the-middle attacks and must never be permitted at runtime.
      ssl: { rejectUnauthorized: true },
    },
  },
};

export default config;
