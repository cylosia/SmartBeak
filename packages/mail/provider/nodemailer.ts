import nodemailer from "nodemailer";
import { config } from "../config";
import type { SendEmailHandler } from "../types";

export const send: SendEmailHandler = async ({
	to,
	from,
	subject,
	cc,
	bcc,
	replyTo,
	text,
	html,
}) => {
	if (
		!process.env.MAIL_HOST ||
		!process.env.MAIL_PORT ||
		!process.env.MAIL_USER ||
		!process.env.MAIL_PASS
	) {
		throw new Error(
			"Missing required MAIL_* environment variables for nodemailer",
		);
	}
	const port = Number.parseInt(process.env.MAIL_PORT, 10);
	if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
		throw new Error(`Invalid MAIL_PORT value: ${process.env.MAIL_PORT}`);
	}
	const transporter = nodemailer.createTransport({
		host: process.env.MAIL_HOST,
		port,
		auth: {
			user: process.env.MAIL_USER,
			pass: process.env.MAIL_PASS,
		},
	});

	await transporter.sendMail({
		to,
		from: from ?? config.mailFrom,
		cc,
		bcc,
		replyTo,
		subject,
		text,
		html,
	});
};
