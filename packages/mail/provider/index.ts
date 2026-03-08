import type { SendEmailHandler } from "../types";
import { send as consoleSend } from "./console";

async function getProvider(): Promise<SendEmailHandler> {
	const provider = process.env.MAIL_PROVIDER ?? "console";

	switch (provider) {
		case "resend":
			return (await import("./resend")).send;
		case "postmark":
			return (await import("./postmark")).send;
		case "nodemailer":
			return (await import("./nodemailer")).send;
		case "mailgun":
			return (await import("./mailgun")).send;
		case "plunk":
			return (await import("./plunk")).send;
		case "console":
			return consoleSend;
		default:
			if (process.env.NODE_ENV === "production") {
				throw new Error(`Unknown MAIL_PROVIDER "${provider}".`);
			}
			console.warn(
				`[mail] Unknown MAIL_PROVIDER "${provider}", falling back to console.`,
			);
			return consoleSend;
	}
}

export const send: SendEmailHandler = async (params) => {
	const provider = await getProvider();
	return provider(params);
};
