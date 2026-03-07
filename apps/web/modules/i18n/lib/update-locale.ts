"use server";

import { setLocaleCookie } from "@i18n/lib/locale-cookie";
import { config, type Locale } from "@repo/i18n";
import { revalidatePath } from "next/cache";

export async function updateLocale(locale: Locale) {
	if (!(locale in config.locales)) {
		return;
	}
	await setLocaleCookie(locale);
	revalidatePath("/");
}
