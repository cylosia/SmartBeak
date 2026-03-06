import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { SeoReportView } from "@/modules/smartbeak/seo-intelligence/components/SeoReportView";

export default async function SeoReportPage({
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
				title="SEO Report"
				subtitle="Org-wide SEO health overview: all domains, keyword counts, scores, and decay signals."
			/>
			<SeoReportView organizationSlug={organizationSlug} />
		</div>
	);
}
