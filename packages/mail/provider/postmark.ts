import { logger } from "@repo/logs";
import { config } from "../config";
import type { SendEmailHandler } from "../types";

export const send: SendEmailHandler = async ({
	to,
	from,
	subject,
	cc,
	bcc,
	replyTo,
	html,
	text,
}) => {
	if (!process.env.POSTMARK_SERVER_TOKEN) {
		throw new Error("Missing POSTMARK_SERVER_TOKEN environment variable");
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	try {
		const response = await fetch("https://api.postmarkapp.com/email", {
			signal: controller.signal,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Postmark-Server-Token": process.env
					.POSTMARK_SERVER_TOKEN as string,
			},
			body: JSON.stringify({
				From: from ?? config.mailFrom,
				To: to,
				CC: cc,
				BCC: bcc,
				ReplyTo: replyTo,
				Subject: subject,
				HtmlBody: html,
				TextBody: text,
				MessageStream: "outbound",
			}),
		});

		if (!response.ok) {
			try {
				logger.error(await response.json());
			} catch {
				logger.error(response.statusText);
			}
			throw new Error("Could not send email");
		}
	} finally {
		clearTimeout(timer);
	}
};
