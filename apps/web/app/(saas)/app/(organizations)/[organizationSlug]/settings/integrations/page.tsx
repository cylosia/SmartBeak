import { isOrganizationAdmin } from "@repo/auth/lib/helper";
import { getActiveOrganization, getSession } from "@saas/auth/lib/server";
import { IntegrationsSettingsForm } from "@saas/organizations/components/IntegrationsSettingsForm";
import { SettingsList } from "@saas/shared/components/SettingsList";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
	const t = await getTranslations();

	return {
		title: t("organizations.settings.integrations.title"),
	};
}

export default async function IntegrationsSettingsPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const session = await getSession();
	const { organizationSlug } = await params;
	const organization = await getActiveOrganization(organizationSlug);

	if (!organization || !isOrganizationAdmin(organization, session?.user)) {
		return notFound();
	}

	return (
		<SettingsList>
			<IntegrationsSettingsForm />
		</SettingsList>
	);
}
