const DEFAULT_MAIL_FROM = "noreply@example.com";
const provider = process.env.MAIL_PROVIDER ?? "console";

export const config = {
	mailFrom: process.env.MAIL_FROM || DEFAULT_MAIL_FROM,
} as const;

if (config.mailFrom === DEFAULT_MAIL_FROM) {
	if (process.env.NODE_ENV === "production" && provider !== "console") {
		throw new Error(
			`MAIL_FROM must be set when MAIL_PROVIDER is "${provider}" in production.`,
		);
	}

	if (process.env.NODE_ENV === "production") {
		console.warn(
			"[mail] MAIL_FROM is not set — using default. Emails may be rejected by providers.",
		);
	}
}
