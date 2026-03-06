import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import dynamic from "next/dynamic";

const PortfolioView = dynamic(
  () => import("@/modules/smartbeak/portfolio/components/PortfolioView").then((m) => m.PortfolioView),
  { ssr: false, loading: () => <div className="animate-pulse h-96 rounded-lg bg-muted" /> },
);

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
