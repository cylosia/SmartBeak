"use client";

import { cn } from "@repo/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function SettingsMenu({
	menuItems,
}: {
	menuItems: {
		title: string;
		avatar: ReactNode;
		items: {
			title: string;
			href: string;
			icon?: ReactNode;
		}[];
	}[];
}) {
	const pathname = usePathname();

	const isActiveMenuItem = (href: string) => pathname.includes(href);

	// Flatten all items from all menu sections into a single array
	const allItems = menuItems.flatMap((item) => item.items);

	return (
		<div className="relative border-b border-gray-200">
			<nav className="flex gap-0">
				{allItems.map((item, index) => {
					const isActive = isActiveMenuItem(item.href);
					return (
						<Link
							key={index}
							href={item.href}
							className={cn(
								"relative border-b-2 px-4 py-2 text-sm transition-colors",
								isActive
									? "border-black font-bold text-black"
									: "border-transparent font-normal text-gray-600",
							)}
						>
							{item.title}
						</Link>
					);
				})}
			</nav>
		</div>
	);
}
