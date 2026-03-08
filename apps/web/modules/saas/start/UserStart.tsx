"use client";

import { config } from "@repo/auth/config";
import { Card } from "@repo/ui/components/card";
import { OrganizationsGrid } from "@saas/organizations/components/OrganizationsGrid";
import { BotMessageSquareIcon, SettingsIcon, ShieldIcon } from "lucide-react";
import Link from "next/link";

const START_LINKS = [
	{
		title: "Open AI chatbot",
		description: "Jump back into your personal workspace and recent AI chat.",
		href: "/app/chatbot",
		icon: BotMessageSquareIcon,
	},
	{
		title: "Manage account settings",
		description: "Update profile, security settings, and connected accounts.",
		href: "/app/settings/general",
		icon: SettingsIcon,
	},
	{
		title: "Review security settings",
		description: "Inspect sessions, passwords, passkeys, and two-factor auth.",
		href: "/app/settings/security",
		icon: ShieldIcon,
	},
] as const;

export default function UserStart() {
	return (
		<div>
			{config.organizations.enable && <OrganizationsGrid />}

			<Card className="mt-6 p-6">
				<div className="max-w-2xl">
					<h2 className="font-semibold text-lg">Choose where to start</h2>
					<p className="mt-2 text-foreground/70 text-sm">
						Use these shortcuts to continue in your personal workspace instead
						of landing on placeholder content.
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
