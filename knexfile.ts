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
      ssl: { rejectUnauthorized: process.env['DB_SSL_REJECT_UNAUTHORIZED'] !== 'false' },
    },
  },
};

export default config;
