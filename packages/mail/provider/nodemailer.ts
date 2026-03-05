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
	if (!process.env.MAIL_HOST || !process.env.MAIL_PORT || !process.env.MAIL_USER || !process.env.MAIL_PASS) {
		throw new Error("Missing required MAIL_* environment variables for nodemailer");
	}
	const transporter = nodemailer.createTransport({
		host: process.env.MAIL_HOST,
		port: Number.parseInt(process.env.MAIL_PORT, 10),
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
