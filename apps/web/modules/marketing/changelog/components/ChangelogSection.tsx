"use client";

import { parseISO } from "date-fns";
import { useLocale } from "next-intl";
import type { ChangelogItem } from "../types";

function formatRelativeDate(value: string, locale: string) {
	const targetDate = parseISO(value);
	const diffMs = targetDate.getTime() - Date.now();
	const divisions: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> =
		[
			{ amount: 1000 * 60 * 60 * 24 * 365, unit: "year" },
			{ amount: 1000 * 60 * 60 * 24 * 30, unit: "month" },
			{ amount: 1000 * 60 * 60 * 24 * 7, unit: "week" },
			{ amount: 1000 * 60 * 60 * 24, unit: "day" },
		];

	for (const { amount, unit } of divisions) {
		if (Math.abs(diffMs) >= amount || unit === "day") {
			return new Intl.RelativeTimeFormat(locale, {
				numeric: "auto",
			}).format(Math.round(diffMs / amount), unit);
		}
	}

	return new Intl.DateTimeFormat(locale).format(targetDate);
}

export function ChangelogSection({ items }: { items: ChangelogItem[] }) {
	const locale = useLocale();

	return (
		<section id="changelog">
			<div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-4 text-left">
				{items?.map((item) => (
					<div
						key={`${item.date}-${item.title}`}
						className="rounded-3xl bg-muted p-6 lg:p-8"
					>
						<div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:justify-between">
							<h2 className="text-xl font-semibold">
								{item.title}
							</h2>
							<small
								className="font-medium text-primary uppercase tracking-wide text-xs whitespace-nowrap"
								title={Intl.DateTimeFormat(locale).format(
									parseISO(item.date),
								)}
							>
								{formatRelativeDate(item.date, locale)}
							</small>
						</div>
						<ul className="mt-4 list-disc space-y-2 pl-6">
							{(item.changes ?? []).map((change, j) => (
								<li key={j}>{change}</li>
							))}
						</ul>
					</div>
				))}
			</div>
		</section>
	);
}
