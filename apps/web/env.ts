import { z } from "zod";

const serverSchema = z.object({
	DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
	BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
});

const optionalSchema = z.object({
	SMARTBEAK_ENCRYPTION_KEY: z.string().optional(),
	ENTERPRISE_ENCRYPTION_KEY: z.string().optional(),
	REDIS_URL: z.string().optional(),
	OPENAI_API_KEY: z.string().optional(),
	MAIL_PROVIDER: z.string().optional(),
	STRIPE_SECRET_KEY: z.string().optional(),
	LEMONSQUEEZY_API_KEY: z.string().optional(),
	VERCEL_TOKEN: z.string().optional(),
});

/**
 * Returns the value of an environment variable that is required for a specific
 * feature but not globally required at startup. Throws a descriptive error at
 * call-time rather than silently returning undefined.
 */
export function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`Missing required environment variable: ${name}\n` +
				`Check your .env.local file and ensure "${name}" is set.`,
		);
	}
	return value;
}

let validated = false;

export function validateEnv() {
	if (validated) {
		return;
	}
	if (typeof window !== "undefined") {
		return;
	}

	const result = serverSchema.safeParse(process.env);
	if (!result.success) {
		const formatted = result.error.issues
			.map((i) => `  - ${i.path.join(".")}: ${i.message}`)
			.join("\n");
		throw new Error(
			`Missing required environment variables:\n${formatted}\n\nCheck your .env.local file.`,
		);
	}

	optionalSchema.safeParse(process.env);
	validated = true;
}
