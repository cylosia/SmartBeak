import { getActiveOrganization } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { OnboardingWizard } from "@/modules/smartbeak/onboarding/components/OnboardingWizard";

export default async function OnboardingWizardPage({
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
        title="Getting Started"
        subtitle="Complete these steps to unlock the full power of SmartBeak."
      />
      <OnboardingWizard organizationSlug={organizationSlug} />
    </div>
  );
}
