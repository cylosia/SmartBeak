import { render } from "@react-email/render";
import type { Locale, Messages } from "@repo/i18n";
import { getMessagesForLocale } from "@repo/i18n";
import { mailTemplates } from "../emails";

export async function getTemplate<T extends TemplateId>({
	templateId,
	context,
	locale,
}: {
	templateId: T;
	context: Omit<
		Parameters<(typeof mailTemplates)[T]>[0],
		"locale" | "translations"
	>;
	locale: Locale;
}) {
	const template = mailTemplates[templateId];
	if (!template) {
		throw new Error(`Unknown mail template: ${String(templateId)}`);
	}

	const translations = await getMessagesForLocale(locale);

	const email = (template as (props: Record<string, unknown>) => JSX.Element)(
		{
			...context,
			locale,
			translations,
		},
	);

	const translatedTemplate =
		translations.mail[templateId as keyof Messages["mail"]];
	const subject =
		translatedTemplate &&
		"subject" in translatedTemplate &&
		typeof translatedTemplate.subject === "string"
			? translatedTemplate.subject.trim()
			: "";
	if (!subject) {
		throw new Error(
			`Missing mail subject translation for template "${String(templateId)}" and locale "${locale}".`,
		);
	}

	const html = await render(email);
	const text = await render(email, { plainText: true });
	return { html, text, subject };
}

export type TemplateId = keyof typeof mailTemplates;
