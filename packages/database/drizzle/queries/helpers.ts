import type { AnyColumn } from "drizzle-orm";
import { type SQL, sql } from "drizzle-orm";

/** Type-safe IN clause for UUID arrays using PostgreSQL's ANY(array) syntax. */
export function inUuidArray(column: AnyColumn, ids: string[]): SQL {
	if (ids.length === 0) {
		return sql`false`;
	}

	return sql`${column} = ANY(ARRAY[${sql.join(
		ids.map((id) => sql`${id}::uuid`),
		sql`, `,
	)}])`;
}

/**
 * Extracts the first row from an INSERT...RETURNING result.
 * Throws if the array is empty, which should never happen for a
 * successful INSERT but guards against driver edge cases.
 */
export function firstOrThrow<T>(rows: T[], label = "row"): T {
	const first = rows[0];
	if (!first) {
		throw new Error(
			`Expected at least one ${label} from INSERT...RETURNING`,
		);
	}
	return first;
}
