import { isOrganizationAdmin } from "@repo/auth/lib/helper";
import { getActiveOrganization, getSession } from "@saas/auth/lib/server";
import { SettingsMenu } from "@saas/settings/components/SettingsMenu";
import { PageHeader } from "@saas/shared/components/PageHeader";
import {
	ActivityIcon,
	CreditCardIcon,
	ShieldCheckIcon,
	UsersIcon,
} from "lucide-react";
import { notFound, redirect } from "next/navigation";
import type { PropsWithChildren } from "react";

export default async function EnterpriseLayout({
	children,
	params,
}: PropsWithChildren<{
	params: Promise<{ organizationSlug: string }>;
}>) {
	const session = await getSession();
	const { organizationSlug } = await params;
	const organization = await getActiveOrganization(organizationSlug);

	if (!organization) {
		notFound();
	}

	const userIsAdmin = isOrganizationAdmin(organization, session?.user);
	if (!userIsAdmin) {
		redirect(`/app/${organizationSlug}`);
	}

	const basePath = `/app/${organizationSlug}/enterprise`;

	const menuItems = [
		{
			title: "Enterprise",
			avatar: <ShieldCheckIcon className="size-5" />,
			items: [
				{
					title: "Team Workspaces",
					href: `${basePath}/teams`,
					icon: <UsersIcon className="size-4 opacity-50" />,
				},
				{
					title: "SSO Configuration",
					href: `${basePath}/sso`,
					icon: <ShieldCheckIcon className="size-4 opacity-50" />,
				},
				{
					title: "Audit Log",
					href: `${basePath}/audit`,
					icon: <ActivityIcon className="size-4 opacity-50" />,
				},
				{
					title: "Billing & Usage",
					href: `${basePath}/billing`,
					icon: <CreditCardIcon className="size-4 opacity-50" />,
				},
			],
		},
	];

	return (
		<>
			<PageHeader
				title="Enterprise"
				subtitle="Security, administration, and scaling controls for your organization."
			/>
			<SettingsMenu menuItems={menuItems} className="mb-6" />
			{children}
		</>
	);
}
