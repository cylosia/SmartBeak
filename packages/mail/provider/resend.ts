import { Resend } from "resend";
import { config } from "../config";
import type { SendEmailHandler } from "../types";

const resend = new Resend(process.env.RESEND_API_KEY);

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
	if (!process.env.RESEND_API_KEY) {
		throw new Error("Missing RESEND_API_KEY environment variable");
	}
	const { error } = await resend.emails.send({
		from: from ?? config.mailFrom,
		to: [to],
		cc,
		bcc,
		replyTo,
		subject,
		html,
		text,
	});
	if (error) {
		throw new Error(error.message ?? "Could not send email via Resend");
	}
};
