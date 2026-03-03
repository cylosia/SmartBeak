import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { PortfolioView } from "@/modules/smartbeak/portfolio/components/PortfolioView";

export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const org = await getActiveOrganization(organizationSlug);
  if (!org) return notFound();

  return (
    <div>
      <PageHeader
        title="Portfolio ROI"
        subtitle="Premium dashboard: portfolio value, ROI, sell-readiness, and buyer attribution."
      />
      <PortfolioView organizationSlug={organizationSlug} />
    </div>
  );
}
