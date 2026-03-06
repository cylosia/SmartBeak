import type { Locale } from "@repo/i18n";

export interface SendEmailParams {
	to: string;
	from?: string;
	cc?: string[];
	bcc?: string[];
	replyTo?: string;
	subject: string;
	text: string;
	html?: string;
}

export type SendEmailHandler = (params: SendEmailParams) => Promise<void>;

export interface MailProvider {
	send: SendEmailHandler;
}

// use-intl's createTranslator requires Record<string, any> for message key inference to work;
// using Record<string, unknown> or AbstractIntlMessages causes keys to resolve to `never`.
export type BaseMailProps = {
	locale: Locale;
	translations: Record<string, any>;
};
