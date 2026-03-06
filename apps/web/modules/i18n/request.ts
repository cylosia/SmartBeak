import { getUserLocale } from "@i18n/lib/locale-cookie";
import { routing } from "@i18n/routing";
import { getMessagesForLocale } from "@repo/i18n";
import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ requestLocale }) => {
	let locale = await requestLocale;

	if (!locale) {
		locale = await getUserLocale();
	}

	if (!routing.locales.includes(locale)) {
		locale = routing.defaultLocale;
	}

	let messages: Awaited<ReturnType<typeof getMessagesForLocale>>;
	try {
		messages = await getMessagesForLocale(locale);
	} catch {
		messages = await getMessagesForLocale(routing.defaultLocale);
	}

	return {
		locale,
		messages,
	};
});
