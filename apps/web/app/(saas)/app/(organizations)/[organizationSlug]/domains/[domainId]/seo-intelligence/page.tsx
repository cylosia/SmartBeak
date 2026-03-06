import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { SeoIntelligenceDashboard } from "@/modules/smartbeak/seo-intelligence/components/SeoIntelligenceDashboard";

export default async function SeoIntelligencePage({
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
				title="SEO Intelligence"
				subtitle="Keyword tracking, decay signals, AI idea generation, and real-time content optimization."
			/>
			<SeoIntelligenceDashboard
				organizationSlug={organizationSlug}
				domainId={domainId}
			/>
		</div>
	);
}
