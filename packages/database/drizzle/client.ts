import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL as string;

if (!databaseUrl) {
	throw new Error("DATABASE_URL is not set");
}

const pool = new Pool({
	connectionString: databaseUrl,
	max: 20,
	idleTimeoutMillis: 30_000,
	connectionTimeoutMillis: 5_000,
});

export const db = drizzle({ client: pool, schema });
