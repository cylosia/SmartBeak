"use client";

import { updateLocale } from "@i18n/lib/update-locale";
import { useLocalePathname, useLocaleRouter } from "@i18n/routing";
import type { Locale } from "@repo/i18n";
import { config } from "@repo/i18n/config";
import { Button } from "@repo/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { LanguagesIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useEffect, useState } from "react";

const { locales } = config;

export function LocaleSwitch({
	withLocaleInUrl = true,
}: {
	withLocaleInUrl?: boolean;
}) {
	const localeRouter = useLocaleRouter();
	const localePathname = useLocalePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	const currentLocale = useLocale();
	const [value, setValue] = useState<string>(currentLocale);

	useEffect(() => {
		setValue(currentLocale);
	}, [currentLocale]);

	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" aria-label="Language">
					<LanguagesIcon className="size-4" />
				</Button>
			</DropdownMenuTrigger>

			<DropdownMenuContent>
				<DropdownMenuRadioGroup
					value={value}
					onValueChange={(value) => {
						if (!(value in locales)) {
							return;
						}

						setValue(value);

						if (withLocaleInUrl) {
							const query = searchParams.toString();
							localeRouter.replace(
								query ? `${localePathname}?${query}` : localePathname,
								{
									locale: value,
								},
							);
						} else {
							updateLocale(value as Locale);
							router.refresh();
						}
					}}
				>
					{Object.entries(locales).map(([locale, { label }]) => {
						return (
							<DropdownMenuRadioItem key={locale} value={locale}>
								{label}
							</DropdownMenuRadioItem>
						);
					})}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
