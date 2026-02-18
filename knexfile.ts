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

  return {
    client: 'postgresql',
    connection: {
      connectionString,
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
      // P1-FIX: Hardcode rejectUnauthorized: true. Previously the env var
      // DB_SSL_REJECT_UNAUTHORIZED=false could disable TLS certificate
      // verification in production, opening connections to MitM attacks.
      // If you need self-signed certs, provide a CA bundle via the `ca`
      // field instead of disabling certificate validation.
      ssl: { rejectUnauthorized: true },
    },
  },
};

export default config;
