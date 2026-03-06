import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { ContentEditorView } from "@/modules/smartbeak/content/components/ContentEditorView";

export async function generateMetadata({
	params,
}: {
	params: Promise<{
		organizationSlug: string;
		domainId: string;
		contentId: string;
	}>;
}) {
	const { organizationSlug } = await params;
	const org = await getActiveOrganization(organizationSlug);
	return { title: `Editor — ${org?.name ?? "SmartBeak"}` };
}

export default async function ContentEditorPage({
	params,
}: {
	params: Promise<{
		organizationSlug: string;
		domainId: string;
		contentId: string;
	}>;
}) {
	const { organizationSlug, domainId, contentId } = await params;
	const org = await getActiveOrganization(organizationSlug);
	if (!org) {
		return notFound();
	}

	return (
		<div>
			<PageHeader
				title="Content Editor"
				subtitle="Rich text editing with revision history and AI idea generation."
			/>
			<ContentEditorView
				organizationSlug={organizationSlug}
				domainId={domainId}
				contentId={contentId}
			/>
		</div>
	);
}
