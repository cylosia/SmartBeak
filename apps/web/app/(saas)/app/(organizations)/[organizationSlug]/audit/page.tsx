import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { AuditLogView } from "@/modules/smartbeak/audit/components/AuditLogView";

export default async function AuditPage({
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
        title="Audit Log"
        subtitle="Immutable record of all actions taken within this organization."
      />
      <AuditLogView organizationSlug={organizationSlug} />
    </div>
  );
}
