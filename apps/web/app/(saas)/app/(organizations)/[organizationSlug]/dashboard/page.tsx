import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { DashboardOverview } from "@/modules/smartbeak/dashboard/components/DashboardOverview";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const org = await getActiveOrganization(organizationSlug);
  return { title: `Dashboard — ${org?.name ?? "SmartBeak"}` };
}

export default async function DashboardPage({
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
        title="Dashboard"
        subtitle={`Overview for ${org.name}`}
      />
      <DashboardOverview organizationSlug={organizationSlug} />
    </div>
  );
}
