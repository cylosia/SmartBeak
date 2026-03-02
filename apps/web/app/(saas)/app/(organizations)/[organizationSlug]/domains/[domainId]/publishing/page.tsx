import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { PublishingView } from "@/modules/smartbeak/publishing/components/PublishingView";

export default async function PublishingPage({
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
        title="Publishing"
        subtitle="Orchestrate multi-channel publishing with retry logic and live status."
      />
      <PublishingView organizationSlug={organizationSlug} domainId={domainId} />
    </div>
  );
}
