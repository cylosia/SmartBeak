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
	if (!process.env.MAILGUN_DOMAIN || !process.env.MAILGUN_API_KEY) {
		throw new Error("Missing required MAILGUN_* environment variables");
	}
	const mailgunDomain = process.env.MAILGUN_DOMAIN;
	const mailgunApiKey = process.env.MAILGUN_API_KEY;

	const body = new FormData();
	body.append("from", from ?? config.mailFrom);
	body.append("to", to);
	body.append("cc", cc?.join(",") ?? "");
	body.append("bcc", bcc?.join(",") ?? "");
	body.append("reply-to", replyTo ?? "");
	body.append("subject", subject);
	body.append("text", text);
	if (html) {
		body.append("html", html);
	}

	const response = await fetch(
		`https://api.mailgun.net/v3/${mailgunDomain}/messages`,
		{
			method: "POST",
			headers: {
				Authorization: `Basic ${Buffer.from(
					`api:${mailgunApiKey}`,
				).toString("base64")}`,
			},
			body,
		},
	);

	if (!response.ok) {
		logger.error(await response.text());

		throw new Error("Could not send email");
	}
};
