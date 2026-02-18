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

/**
 * FIX BUG-07: Extract validated connection-string lookup into its own function.
 * getBaseConfig() formerly both validated and read the env var. The production
 * block then re-read process.env['CONTROL_PLANE_DB'] without validation, so if
 * getBaseConfig() were ever removed from the spread, the production config could
 * silently use an undefined connection string. This helper is the single source
 * of truth for the validated value.
 */
function getValidatedConnectionString(): string {
  const connectionString = process.env['CONTROL_PLANE_DB'];
  if (!connectionString) {
    throw new Error(
      'CONTROL_PLANE_DB environment variable is required. ' +
      'Set it to your PostgreSQL connection string.'
    );
  }
  return connectionString;
}

function getBaseConfig(): Knex.Config {
  const connectionString = getValidatedConnectionString();

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
    // FIX BUG-08: Added pool timeout parameters. Without these a hung migration
    // query holds a connection indefinitely with no timeout error or diagnostic.
    pool: {
      min: 1,
      max: 5,
      acquireTimeoutMillis: 30_000,   // fail fast if pool exhausted during migration
      createTimeoutMillis: 10_000,    // fail fast if new connection cannot be created
      idleTimeoutMillis: 60_000,      // release idle connections after 1 minute
    },
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
      // FIX BUG-07: Reuse the validated connection string from the shared helper
      // instead of re-reading process.env['CONTROL_PLANE_DB'] without validation.
      connectionString: getValidatedConnectionString(),
      // FIX P1-08: Hard-code rejectUnauthorized: true in production.
      // DB_SSL_REJECT_UNAUTHORIZED is intentionally NOT consulted here.
      // Disabling certificate verification opens the production database to
      // man-in-the-middle attacks and must never be permitted at runtime.
      ssl: { rejectUnauthorized: true },
    },
  },
};

export default config;
