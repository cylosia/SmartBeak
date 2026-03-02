import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { BillingView } from "@/modules/smartbeak/billing/components/BillingView";

export default async function BillingPage({
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
        title="Billing & Usage"
        subtitle="Manage your subscription, invoices, and usage quotas."
      />
      <BillingView organizationSlug={organizationSlug} />
    </div>
  );
}
