import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { DiligenceView } from "@/modules/smartbeak/portfolio/components/DiligenceView";

export default async function DiligencePage({
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
        title="Diligence Report"
        subtitle="Decay signals, buyer sessions, and sell-readiness checks for this domain."
      />
      <DiligenceView organizationSlug={organizationSlug} domainId={domainId} />
    </div>
  );
}
