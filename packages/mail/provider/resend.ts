import { Resend } from "resend";
import { config } from "../config";
import type { SendEmailHandler } from "../types";

let resend: Resend | null = null;

function getResendClient(): Resend {
	if (!process.env.RESEND_API_KEY) {
		throw new Error("Missing RESEND_API_KEY environment variable");
	}
	if (!resend) {
		resend = new Resend(process.env.RESEND_API_KEY);
	}
	return resend;
}

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
	const client = getResendClient();
	const { error } = await client.emails.send({
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
