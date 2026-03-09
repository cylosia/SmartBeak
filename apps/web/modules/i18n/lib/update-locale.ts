"use server";

import { setLocaleCookie } from "@i18n/lib/locale-cookie";
import type { Locale } from "@repo/i18n";
import { config } from "@repo/i18n/config";
import { revalidatePath } from "next/cache";

export async function updateLocale(locale: Locale) {
	if (!(locale in config.locales)) {
		return;
	}
	await setLocaleCookie(locale);
	revalidatePath("/");
}
