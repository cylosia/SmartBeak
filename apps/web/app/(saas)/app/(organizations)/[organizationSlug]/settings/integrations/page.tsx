import { SettingsList } from "@saas/shared/components/SettingsList";
import { IntegrationsSettingsForm } from "@saas/organizations/components/IntegrationsSettingsForm";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
	const t = await getTranslations();

	return {
		title: t("organizations.settings.integrations.title"),
	};
}

export default function IntegrationsSettingsPage() {
	return (
		<SettingsList>
			<IntegrationsSettingsForm />
		</SettingsList>
	);
}
