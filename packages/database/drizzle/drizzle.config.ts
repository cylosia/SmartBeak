import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "postgresql",
	// Unified schema: Supastarter Pro base + SmartBeak v9 locked schema
	schema: "./drizzle/schema/index.ts",
	dbCredentials: {
		url: process.env.DATABASE_URL as string,
	},
});
