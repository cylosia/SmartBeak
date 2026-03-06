import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { SeoView } from "@/modules/smartbeak/seo/components/SeoView";

export default async function SeoPage({
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
				title="SEO Tools"
				subtitle="Track keywords, monitor scores, and optimize your domain for search engines."
			/>
			<SeoView organizationSlug={organizationSlug} domainId={domainId} />
		</div>
	);
}
