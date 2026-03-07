import { logger } from "@repo/logs";
import type { SendEmailHandler } from "../types";

export const send: SendEmailHandler = async ({
	to,
	subject,
	cc,
	bcc,
	replyTo,
	html,
	text,
}) => {
	if (!process.env.PLUNK_API_KEY) {
		throw new Error("Missing PLUNK_API_KEY environment variable");
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	const response = await fetch("https://api.useplunk.com/v1/send", {
		signal: controller.signal,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${process.env.PLUNK_API_KEY}`,
		},
		body: JSON.stringify({
			to,
			cc,
			bcc,
			replyTo,
			subject,
			body: html,
			text,
		}),
	});

	clearTimeout(timer);

	if (!response.ok) {
		const errorBody = await response.text();
		logger.error(errorBody);
		throw new Error("Could not send email");
	}
};
