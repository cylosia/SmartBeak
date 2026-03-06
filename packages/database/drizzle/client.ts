import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL as string;

if (!databaseUrl) {
	throw new Error("DATABASE_URL is not set");
}

const pool = new Pool({
	connectionString: databaseUrl,
	max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? "20", 10),
	idleTimeoutMillis: 30_000,
	connectionTimeoutMillis: 5_000,
});

export const db = drizzle({ client: pool, schema });
