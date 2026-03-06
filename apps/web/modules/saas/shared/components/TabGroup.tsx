"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { useMemo } from "react";

export function TabGroup({
	items,
	className,
}: {
	items: { label: string; href: string; segment: string }[];
	className?: string;
}) {
	const selectedSegment = useSelectedLayoutSegment();
	const safeItems = items ?? [];
	const activeItem = useMemo(() => {
		return safeItems.find((item) => item.segment === selectedSegment);
	}, [safeItems, selectedSegment]);

	return (
		<div className={` flex border-b-2 ${className}`}>
			{safeItems.map((item) => (
				<Link
					key={item.href}
					href={item.href}
					className={`-mb-0.5 block border-b-2 px-6 py-3 ${
						item === activeItem
							? "border-primary font-bold"
							: "border-transparent"
					}`}
				>
					{item.label}
				</Link>
			))}
		</div>
	);
}
