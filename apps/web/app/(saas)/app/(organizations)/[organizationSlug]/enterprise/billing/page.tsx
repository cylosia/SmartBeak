import { EnterpriseBillingDashboard } from "@/modules/smartbeak/enterprise/billing/components/EnterpriseBillingDashboard";

export async function generateMetadata() {
	return { title: "Billing & Usage — Enterprise" };
}

export default async function EnterpriseBillingPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	return <EnterpriseBillingDashboard organizationSlug={organizationSlug} />;
}
