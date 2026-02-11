import { knex, Knex } from 'knex';
import { getLogger } from '@kernel/logger';

const logger = getLogger('database:knex');

let knexInstance: Knex | null = null;
let knexInitializing = false;
let knexInitPromise: Promise<Knex> | null = null;

/**
 * Get the database connection string from environment
 * Lazy validation - only called when connection is needed
 */
function getConnectionString(): string {
  const connectionString = process.env['CONTROL_PLANE_DB'];

  if (!connectionString) {
    throw new Error(
      'DATABASE_NOT_CONFIGURED: CONTROL_PLANE_DB environment variable is required. ' +
      'Please set it to your PostgreSQL connection string.'
    );
  }

  return connectionString;
}

/**
 * Lazy initialization of the Knex query builder instance
 */
async function getKnexInstance(): Promise<Knex> {
  if (knexInstance) return knexInstance;
  if (knexInitializing && knexInitPromise) return knexInitPromise;

  knexInitializing = true;
  knexInitPromise = (async () => {
    const connectionString = getConnectionString();

    knexInstance = knex({
      client: 'pg',
      connection: connectionString,
      pool: {
        // P1-FIX: Connection pool sizing - reduced max to prevent overload
        min: 2,
        max: 10, // Reduced from 20 to prevent connection pool exhaustion
        // P1-FIX: Pool lifecycle management
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 30000,
        createTimeoutMillis: 30000,
        destroyTimeoutMillis: 5000,
        reapIntervalMillis: 1000,
      },
    });

    return knexInstance;
  })();

  return knexInitPromise;
}

/**
 * Lazy getter for the Knex instance
 * Returns a proxy that initializes on first use
 *
 * NOTE: This is for backward compatibility.
 * For new code, prefer using the async query functions above.
 */
export async function getDb(): Promise<Knex> {
  return getKnexInstance();
}

/**
 * Get the Knex instance (for direct access)
 */
export async function getKnex(): Promise<Knex> {
  return getKnexInstance();
}

// Export internal function for other modules
export { getKnexInstance };
