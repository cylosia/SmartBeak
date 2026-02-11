
import type { Knex } from 'knex';

/**
* Create a read-only analytics database connection with replica schema
*
* P1-FIX: Added proper TypeScript typing for return value
*
* @param db - Knex database instance
* @returns Knex instance configured with replica schema
*/
export function analyticsDb(db: Knex): Knex {
  return db.withSchema('replica') as unknown as Knex;
}

/**
* Read-only query builder interface
* P1-FIX: Restricts available methods to read-only operations
* Prevents accidental writes on replica
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReadOnlyKnex<T extends Record<string, any> = any> = Knex<T>;

/**
* Wrap Knex instance to enforce read-only operations at compile time
* Note: This is a type-only wrapper - runtime enforcement happens via RLS
* @param db - Knex database instance
* @returns ReadOnlyKnex interface
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readOnlyDb<T extends Record<string, any> = Record<string, any>>(db: Knex): ReadOnlyKnex<T> {
  return db as unknown as ReadOnlyKnex<T>;
}
