import { SsoConfigPage } from "@/modules/smartbeak/enterprise/sso/components/SsoConfigPage";

export async function generateMetadata() {
	return { title: "Single Sign-On — Enterprise" };
}

export default async function EnterpriseSsoPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	return <SsoConfigPage organizationSlug={organizationSlug} />;
}
