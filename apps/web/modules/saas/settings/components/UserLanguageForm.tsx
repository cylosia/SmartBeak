"use client";

import { updateLocale } from "@i18n/lib/update-locale";
import { authClient } from "@repo/auth/client";
import type { Locale } from "@repo/i18n";
import { config } from "@repo/i18n/config";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@repo/ui/components/select";
import { toastError, toastSuccess } from "@repo/ui/components/toast";
import { SettingsItem } from "@saas/shared/components/SettingsItem";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

const { locales } = config;

export function UserLanguageForm() {
	const currentLocale = useLocale();
	const t = useTranslations();
	const router = useRouter();
	const [locale, setLocale] = useState<Locale | undefined>(
		currentLocale as Locale,
	);

	const updateLocaleMutation = useMutation({
		mutationFn: async (nextLocale: Locale) => {
			const { error } = await authClient.updateUser({
				locale: nextLocale,
			} as Record<string, unknown>);

			if (error) {
				throw error;
			}

			if (!nextLocale) {
				return;
			}

			await updateLocale(nextLocale);
			router.refresh();
		},
	});

	const saveLocale = async (nextLocale: Locale) => {
		try {
			await updateLocaleMutation.mutateAsync(nextLocale);

			toastSuccess(t("settings.account.language.notifications.success"));
		} catch {
			setLocale(currentLocale as Locale);
			toastError(t("settings.account.language.notifications.error"));
		}
	};

	return (
		<SettingsItem
			title={t("settings.account.language.title")}
			description={t("settings.account.language.description")}
		>
			<Select
				value={locale}
				onValueChange={(value) => {
				const nextLocale = value as Locale;
				setLocale(nextLocale);
				saveLocale(nextLocale);
				}}
				disabled={updateLocaleMutation.isPending}
			>
				<SelectTrigger>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{Object.entries(locales).map(([key, value]) => (
						<SelectItem key={key} value={key}>
							{value.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</SettingsItem>
	);
}
