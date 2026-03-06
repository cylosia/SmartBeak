import { isOrganizationAdmin } from "@repo/auth/lib/helper";
import { getActiveOrganization, getSession } from "@saas/auth/lib/server";
import { DeleteOrganizationForm } from "@saas/organizations/components/DeleteOrganizationForm";
import { SettingsList } from "@saas/shared/components/SettingsList";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
	const t = await getTranslations();

	return {
		title: t("organizations.settings.dangerZone.title"),
	};
}

export default async function OrganizationSettingsPage({
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
			<DeleteOrganizationForm />
		</SettingsList>
	);
}
