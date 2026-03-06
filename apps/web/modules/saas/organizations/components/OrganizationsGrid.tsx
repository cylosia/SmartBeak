"use client";

import { config } from "@repo/auth/config";
import { Button } from "@repo/ui/components/button";
import { Card } from "@repo/ui/components/card";
import { OrganizationLogo } from "@saas/organizations/components/OrganizationLogo";
import { useActiveOrganization } from "@saas/organizations/hooks/use-active-organization";
import { useOrganizationListQuery } from "@saas/organizations/lib/api";
import { ChevronRightIcon, PlusCircleIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export function OrganizationsGrid() {
	const t = useTranslations();
	const { setActiveOrganization } = useActiveOrganization();
	const {
		data: allOrganizations,
		isLoading,
		isError,
		refetch,
	} = useOrganizationListQuery();

	if (isLoading) {
		return (
			<div className="@container">
				<h2 className="mb-2 font-semibold text-lg">
					{t("organizations.organizationsGrid.title")}
				</h2>
				<div className="grid @2xl:grid-cols-3 @lg:grid-cols-2 grid-cols-1 gap-4">
					{[1, 2, 3].map((i) => (
						<div
							key={i}
							className="h-20 animate-pulse rounded-2xl bg-muted"
						/>
					))}
				</div>
			</div>
		);
	}

	if (isError) {
		return (
			<div className="@container">
				<h2 className="mb-2 font-semibold text-lg">
					{t("organizations.organizationsGrid.title")}
				</h2>
				<div className="flex flex-col items-center py-8 text-center">
					<p className="text-sm text-destructive">
						Failed to load organizations.
					</p>
					<Button
						variant="outline"
						size="sm"
						className="mt-2"
						onClick={() => refetch()}
					>
						Retry
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="@container">
			<h2 className="mb-2 font-semibold text-lg">
				{t("organizations.organizationsGrid.title")}
			</h2>
			<div className="grid @2xl:grid-cols-3 @lg:grid-cols-2 grid-cols-1 gap-4">
				{allOrganizations?.map((organization) => (
					<Card
						key={organization.id}
						role="button"
						tabIndex={0}
						className="flex cursor-pointer items-center gap-4 overflow-hidden p-4"
						onClick={() => setActiveOrganization(organization.slug)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								setActiveOrganization(organization.slug);
							}
						}}
					>
						<OrganizationLogo
							name={organization.name}
							logoUrl={organization.logo}
							className="size-12"
						/>
						<span className="flex items-center gap-1 text-base leading-tight">
							<span className="block font-medium">
								{organization.name}
							</span>
							<ChevronRightIcon className="size-4" />
						</span>
					</Card>
				))}

				{config.organizations.enableUsersToCreateOrganizations && (
					<Link
						href="/new-organization"
						className="flex h-full items-center justify-center gap-2 rounded-2xl bg-primary/5 p-4 text-primary transition-colors duration-150 hover:bg-primary/10"
					>
						<PlusCircleIcon />
						<span className="font-medium text-sm">
							{t(
								"organizations.organizationsGrid.createNewOrganization",
							)}
						</span>
					</Link>
				)}
			</div>
		</div>
	);
}
