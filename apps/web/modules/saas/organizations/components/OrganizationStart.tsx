"use client";
import { Card } from "@repo/ui/components/card";
import {
	BarChart3Icon,
	GlobeIcon,
	SettingsIcon,
} from "lucide-react";
import Link from "next/link";

const START_LINKS = [
	{
		title: "Open dashboard",
		description: "Review your current organization activity and high-level health.",
		href: "dashboard",
		icon: BarChart3Icon,
	},
	{
		title: "Manage domains",
		description: "Add domains, inspect assets, and continue content operations.",
		href: "domains",
		icon: GlobeIcon,
	},
	{
		title: "Update settings",
		description: "Manage branding, members, integrations, and access controls.",
		href: "settings/general",
		icon: SettingsIcon,
	},
] as const;

export default function OrganizationStart() {
	return (
		<div className="@container">
			<Card className="p-6">
				<div className="max-w-2xl">
					<h2 className="font-semibold text-lg">Choose where to start</h2>
					<p className="mt-2 text-foreground/70 text-sm">
						This organization workspace is ready. Jump into the main areas
						below instead of showing placeholder analytics or synthetic
						business metrics.
					</p>
				</div>

				<div className="mt-6 grid gap-4 @xl:grid-cols-3">
					{START_LINKS.map((link) => {
						const Icon = link.icon;

						return (
							<Link
								key={link.href}
								href={link.href}
								className="rounded-xl border p-4 transition-colors hover:bg-muted/40"
							>
								<div className="flex items-start gap-3">
									<div className="rounded-lg bg-primary/10 p-2 text-primary">
										<Icon className="size-4" />
									</div>
									<div>
										<div className="font-medium">{link.title}</div>
										<p className="mt-1 text-foreground/70 text-sm">
											{link.description}
										</p>
									</div>
								</div>
							</Link>
						);
					})}
				</div>
			</Card>
		</div>
	);
}
