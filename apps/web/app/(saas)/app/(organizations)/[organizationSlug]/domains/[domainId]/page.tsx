import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { DomainDetailView } from "@/modules/smartbeak/domains/components/DomainDetailView";

export default async function DomainDetailPage({
	params,
}: {
	params: Promise<{ organizationSlug: string; domainId: string }>;
}) {
	const { organizationSlug, domainId } = await params;
	const org = await getActiveOrganization(organizationSlug);
	if (!org) {
		return notFound();
	}

	return (
		<div>
			<PageHeader
				title="Domain Overview"
				subtitle="Recorded domain metadata, health snapshots, and quick links."
			/>
			<DomainDetailView
				organizationSlug={organizationSlug}
				domainId={domainId}
			/>
		</div>
	);
}
