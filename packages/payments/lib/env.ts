/**
 * Payment provider environment variable validation.
 *
 * Provides a type-safe `requireEnv` helper that validates an env var
 * is present and non-empty, replacing the `process.env.X as string`
 * pattern. Each provider calls this at initialization time so missing
 * config surfaces immediately instead of silently producing `undefined`.
 */

export function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`Missing required environment variable: ${name}. ` +
				"Ensure it is set in your .env file or hosting provider.",
		);
	}
	return value;
}
