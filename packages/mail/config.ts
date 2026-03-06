const DEFAULT_MAIL_FROM = "noreply@example.com";

export const config = {
	mailFrom: process.env.MAIL_FROM || DEFAULT_MAIL_FROM,
} as const;

if (
	config.mailFrom === DEFAULT_MAIL_FROM &&
	process.env.NODE_ENV === "production"
) {
	console.warn(
		"[mail] MAIL_FROM is not set — using default. Emails may be rejected by providers.",
	);
}
