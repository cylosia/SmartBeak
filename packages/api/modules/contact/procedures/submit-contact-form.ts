import { ORPCError } from "@orpc/server";
import { logger } from "@repo/logs";
import { sendEmail } from "@repo/mail";
import { escapeHtml } from "@repo/utils";
import { config } from "../../../config";
import { localeMiddleware } from "../../../orpc/middleware/locale-middleware";
import { publicRateLimitMiddleware } from "../../../orpc/middleware/rate-limit-middleware";
import { publicProcedure } from "../../../orpc/procedures";
import { contactFormSchema } from "../types";

export const submitContactForm = publicProcedure
	.route({
		method: "POST",
		path: "/contact",
		tags: ["Contact"],
		summary: "Submit contact form",
	})
	.input(contactFormSchema)
	.use(publicRateLimitMiddleware({ limit: 5, windowMs: 60_000 }))
	.use(localeMiddleware)
	.handler(
		async ({ input: { email, name, message }, context: { locale } }) => {
			if (!config.contactFormTo) {
				logger.error(
					"Contact form submission failed: CONTACT_FORM_TO_MAIL not configured",
				);
				throw new ORPCError("INTERNAL_SERVER_ERROR");
			}

			try {
				const escapedName = escapeHtml(name);
				const escapedEmail = escapeHtml(email);
				const escapedMessage = escapeHtml(message);

				await sendEmail({
					to: config.contactFormTo,
					locale,
					subject: "Contact Form Submission",
					text: `Name: ${escapedName}\n\nEmail: ${escapedEmail}\n\nMessage: ${escapedMessage}`,
				});
			} catch (error) {
				logger.error(error);
				throw new ORPCError("INTERNAL_SERVER_ERROR");
			}
		},
	);
