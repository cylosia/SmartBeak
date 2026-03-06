import { logger } from "@repo/logs";

export const config = {
	contactFormTo: process.env.CONTACT_FORM_TO_MAIL ?? "",
} as const;

if (!config.contactFormTo) {
	logger.warn(
		"[api/config] CONTACT_FORM_TO_MAIL is not set — contact form submissions will fail.",
	);
}
