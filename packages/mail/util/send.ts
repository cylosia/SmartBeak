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
	console.log('[SmartBeak-Debug] sendEmail called', { to, hasTemplateId: 'templateId' in params, locale, mailProvider: process.env.MAIL_PROVIDER });
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
			// #region agent log
			console.log('[SmartBeak-Debug] getTemplate succeeded', { templateId, subjectLength: subject.length });
			// #endregion
		} catch (templateErr) {
			// #region agent log
			console.error('[SmartBeak-Debug] getTemplate FAILED', { templateId, error: String(templateErr) });
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
		// #region agent log
		console.log('[SmartBeak-Debug] calling send()', { to, provider: process.env.MAIL_PROVIDER });
		// #endregion
		await send({
			to,
			from,
			subject,
			text,
			html,
		});
		// #region agent log
		console.log('[SmartBeak-Debug] send() succeeded', { to });
		// #endregion
		return true;
	} catch (e) {
		// #region agent log
		console.error('[SmartBeak-Debug] send() FAILED', { error: String(e), stack: (e as Error)?.stack?.slice(0, 500) });
		// #endregion
		logger.error(e);
		return false;
	}
}
