import { EnterpriseAuditLog } from "@/modules/smartbeak/enterprise/audit/components/EnterpriseAuditLog";

export async function generateMetadata() {
  return { title: "Audit Log — Enterprise" };
}

export default async function EnterpriseAuditPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  return <EnterpriseAuditLog organizationSlug={organizationSlug} />;
}
