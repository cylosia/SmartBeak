import type { AnyColumn } from "drizzle-orm";
import { type SQL, sql } from "drizzle-orm";

/** Type-safe IN clause for UUID arrays using PostgreSQL's ANY(array) syntax. */
export function inUuidArray(column: AnyColumn, ids: string[]): SQL {
	return sql`${column} = ANY(ARRAY[${sql.join(
		ids.map((id) => sql`${id}::uuid`),
		sql`, `,
	)}])`;
}
