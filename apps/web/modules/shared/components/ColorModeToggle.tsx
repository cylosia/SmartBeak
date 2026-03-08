"use client";

import { cn } from "@repo/ui";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@repo/ui/components/tooltip";
import { MonitorCogIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useIsClient } from "usehooks-ts";

const COLOR_MODE_OPTIONS = [
	{
		value: "system",
		icon: MonitorCogIcon,
	},
	{
		value: "light",
		icon: SunIcon,
	},
	{
		value: "dark",
		icon: MoonIcon,
	},
] as const;

type ColorModeValue = (typeof COLOR_MODE_OPTIONS)[number]["value"];

function normalizeColorMode(value: string | undefined): ColorModeValue {
	return COLOR_MODE_OPTIONS.some((option) => option.value === value)
		? (value as ColorModeValue)
		: "system";
}

export function ColorModeToggle() {
	const { setTheme, theme } = useTheme();
	const [value, setValue] = useState<ColorModeValue>(
		normalizeColorMode(theme),
	);
	const isClient = useIsClient();
	const t = useTranslations();

	useEffect(() => {
		setValue(normalizeColorMode(theme));
	}, [theme]);

	if (!isClient) {
		return null;
	}

	const activeIndex = COLOR_MODE_OPTIONS.findIndex(
		(option) => option.value === value,
	);

	const handleClick = (optionValue: ColorModeValue) => {
		setTheme(optionValue);
		setValue(optionValue);
	};

	return (
		<TooltipProvider delayDuration={0}>
			<div
				className="relative inline-flex items-center gap-0 rounded-full bg-muted p-0.5"
				data-test="color-mode-toggle"
			>
				{/* Active indicator */}
				<div
					className="absolute left-0.5 top-0.5 h-7 w-7 rounded-full bg-background shadow-sm transition-transform duration-200 ease-in-out border border-border"
					style={{
						transform: `translateX(${activeIndex * 100}%)`,
					}}
					aria-hidden="true"
				/>

				{/* Icons */}
				{COLOR_MODE_OPTIONS.map((option) => {
					const Icon = option.icon;
					const isActive = option.value === value;
					const label = t(`common.colorMode.${option.value}`);

					return (
						<Tooltip key={option.value}>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={() => handleClick(option.value)}
									className={cn(
										"relative z-10 flex h-7 w-7 items-center justify-center rounded-full transition-colors",
										"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
										isActive
											? "text-foreground"
											: "text-muted-foreground hover:text-foreground",
									)}
									data-test={`color-mode-toggle-item-${option.value}`}
									aria-label={`${label} mode`}
									aria-pressed={isActive}
								>
									<Icon className="size-3.5" />
								</button>
							</TooltipTrigger>
							<TooltipContent>{label}</TooltipContent>
						</Tooltip>
					);
				})}
			</div>
		</TooltipProvider>
	);
}
