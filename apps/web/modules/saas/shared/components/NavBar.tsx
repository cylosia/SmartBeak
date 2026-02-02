"use client";

import { config as authConfig } from "@repo/auth/config";
import { cn, Logo } from "@repo/ui";
import { useSession } from "@saas/auth/hooks/use-session";
import { useActiveOrganization } from "@saas/organizations/hooks/use-active-organization";
import { UserMenu } from "@saas/shared/components/UserMenu";
import {
	BotMessageSquareIcon,
	ChevronRightIcon,
	HomeIcon,
	SettingsIcon,
	UserCog2Icon,
	UserCogIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { config as webConfig } from "@/config";
import { OrganzationSelect } from "../../organizations/components/OrganizationSelect";

export function NavBar() {
	const t = useTranslations();
	const pathname = usePathname();
	const { user } = useSession();
	const { activeOrganization, isOrganizationAdmin } = useActiveOrganization();

	const { useSidebarLayout } = webConfig.saas;

	const basePath = activeOrganization
		? `/app/${activeOrganization.slug}`
		: "/app";

	const menuItems = [
		{
			label: t("app.menu.start"),
			href: basePath,
			icon: HomeIcon,
			isActive: pathname === basePath,
		},
		{
			label: t("app.menu.aiChatbot"),
			href: activeOrganization
				? `/app/${activeOrganization.slug}/chatbot`
				: "/app/chatbot",
			icon: BotMessageSquareIcon,
			isActive: pathname.includes("/chatbot"),
		},
		...(activeOrganization && isOrganizationAdmin
			? [
					{
						label: t("app.menu.organizationSettings"),
						href: `${basePath}/settings`,
						icon: SettingsIcon,
						isActive: pathname.startsWith(`${basePath}/settings/`),
					},
				]
			: []),
		{
			label: t("app.menu.accountSettings"),
			href: "/app/settings",
			icon: UserCog2Icon,
			isActive: pathname.startsWith("/app/settings/"),
		},
		...(user?.role === "admin"
			? [
					{
						label: t("app.menu.admin"),
						href: "/app/admin",
						icon: UserCogIcon,
						isActive: pathname.startsWith("/app/admin/"),
					},
				]
			: []),
	];

	return (
		<nav
			className={cn("w-full", {
				"w-full md:fixed md:top-0 md:left-0 md:h-full md:w-[280px]":
					useSidebarLayout,
			})}
		>
			<div
				className={cn("container max-w-6xl py-4", {
					"py-4 md:flex md:h-full md:flex-col md:px-4 md:pb-0":
						useSidebarLayout,
				})}
			>
				<div className="flex flex-wrap items-center justify-between gap-6">
					<div
						className={cn("flex items-center gap-6 md:gap-2", {
							"md:flex md:w-full md:flex-col md:items-stretch md:align-stretch":
								useSidebarLayout,
						})}
					>
						<Link href="/app" className="block">
							<Logo withLabel={false} />
						</Link>

						{authConfig.organizations.enable &&
							!authConfig.organizations.hideOrganization && (
								<>
									<span
										className={cn(
											"hidden opacity-30 md:block",
											{
												"md:hidden": useSidebarLayout,
											},
										)}
									>
										<ChevronRightIcon className="size-4" />
									</span>

									<OrganzationSelect
										className={cn({
											"md:mt-2": useSidebarLayout,
										})}
									/>
								</>
							)}
					</div>

					<div
						className={cn(
							"mr-0 ml-auto flex items-center justify-end gap-4",
							{
								"md:hidden": useSidebarLayout,
							},
						)}
					>
						<UserMenu />
					</div>
				</div>

				<ul
					className={cn(
						"no-scrollbar mt-4 flex list-none items-center justify-start gap-2 overflow-x-auto text-sm",
						{
							"md:mx-0 md:my-6 md:flex md:flex-col md:items-stretch md:gap-1 md:px-0":
								useSidebarLayout,
						},
					)}
				>
					{menuItems.map((menuItem) => (
						<li key={menuItem.href}>
							<Link
								href={menuItem.href}
								className={cn(
									"flex items-center border border-transparent gap-3 whitespace-nowrap rounded-lg px-3 py-2 transition-colors",
									{
										"font-semibold bg-card border-border":
											menuItem.isActive,
										"hover:bg-muted/50": !menuItem.isActive,
										"md:w-full": useSidebarLayout,
									},
								)}
								prefetch
							>
								<menuItem.icon
									className={cn(
										"size-4 shrink-0",
										menuItem.isActive
											? "text-foreground"
											: "text-muted-foreground opacity-60",
									)}
								/>
								<span
									className={cn({
										"text-foreground": menuItem.isActive,
										"text-muted-foreground":
											!menuItem.isActive,
									})}
								>
									{menuItem.label}
								</span>
							</Link>
						</li>
					))}
				</ul>

				<div
					className={cn("mt-auto mb-0 hidden py-4", {
						"md:block": useSidebarLayout,
					})}
				>
					<UserMenu showUserName />
				</div>
			</div>
		</nav>
	);
}
