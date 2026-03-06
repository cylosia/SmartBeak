import { config as i18nConfig } from "@repo/i18n/config";
import { logger } from "@repo/logs";
import type { mailTemplates } from "../emails";
import { send } from "../provider";
import type { TemplateId } from "./templates";
import { getTemplate } from "./templates";

export async function sendEmail<T extends TemplateId>(
	params: {
		to: string;
		from?: string;
		locale?: keyof typeof i18nConfig.locales;
	} & (
		| {
				templateId: T;
				context: Omit<
					Parameters<(typeof mailTemplates)[T]>[0],
					"locale" | "translations"
				>;
		  }
		| {
				subject: string;
				text?: string;
				html?: string;
		  }
	),
) {
	const { to, from, locale = i18nConfig.defaultLocale } = params;

	let html: string;
	let text: string;
	let subject: string;

	// #region agent log
	console.log('[SmartBeak-Debug] sendEmail called', { to, templateId: 'templateId' in params ? (params as any).templateId : 'N/A', locale, mailProvider: process.env.MAIL_PROVIDER ?? '(unset → console)' });
	// #endregion

	if ("templateId" in params) {
		const { templateId, context } = params;
		try {
			const template = await getTemplate({
				templateId,
				context,
				locale,
			});
			subject = template.subject;
			text = template.text;
			html = template.html;
		} catch (templateErr) {
			// #region agent log
			console.error('[SmartBeak-Debug] getTemplate FAILED', { error: String(templateErr) });
			// #endregion
			logger.error(templateErr);
			return false;
		}
	} else {
		subject = params.subject;
		text = params.text ?? "";
		html = params.html ?? "";
	}

	try {
		await send({
			to,
			from,
			subject,
			text,
			html,
		});
		// #region agent log
		console.log('[SmartBeak-Debug] send() completed', { to, provider: process.env.MAIL_PROVIDER ?? '(unset → console)' });
		// #endregion
		return true;
	} catch (e) {
		// #region agent log
		console.error('[SmartBeak-Debug] send() FAILED', { error: String(e) });
		// #endregion
		logger.error(e);
		return false;
	}
}
