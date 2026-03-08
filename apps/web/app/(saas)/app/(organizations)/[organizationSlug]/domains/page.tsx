import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { DomainsListView } from "@/modules/smartbeak/domains/components/DomainsListView";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	const org = await getActiveOrganization(organizationSlug);
	return { title: `Domains — ${org?.name ?? "SmartBeak"}` };
}

export default async function DomainsPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	const org = await getActiveOrganization(organizationSlug);
	if (!org) {
		return notFound();
	}

	return (
		<div>
			<PageHeader
				title="Domains"
				subtitle="Manage your web properties, recorded metadata, and deployment status."
			/>
			<DomainsListView organizationSlug={organizationSlug} />
		</div>
	);
}
