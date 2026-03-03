import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { ContentListView } from "@/modules/smartbeak/content/components/ContentListView";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ organizationSlug: string; domainId: string }>;
}) {
  const { organizationSlug } = await params;
  const org = await getActiveOrganization(organizationSlug);
  return { title: `Content — ${org?.name ?? "SmartBeak"}` };
}

export default async function ContentPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; domainId: string }>;
}) {
  const { organizationSlug, domainId } = await params;
  const org = await getActiveOrganization(organizationSlug);
  if (!org) return notFound();

  return (
    <div>
      <PageHeader
        title="Content"
        subtitle="Create, edit, and publish content for this domain."
      />
      <ContentListView organizationSlug={organizationSlug} domainId={domainId} />
    </div>
  );
}
