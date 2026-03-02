import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { SmartDeployStub } from "@/modules/smartbeak/smart-deploy/components/SmartDeployStub";

export default async function SmartDeployPage({
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
        title="SmartDeploy"
        subtitle="One-click site deployment engine — edge-powered global publishing."
      />
      <SmartDeployStub organizationSlug={organizationSlug} />
    </div>
  );
}
