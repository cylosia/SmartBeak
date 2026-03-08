import { isOrganizationAdmin } from "@repo/auth/lib/helper";
import { getActiveOrganization, getSession } from "@saas/auth/lib/server";
import { PageHeader } from "@saas/shared/components/PageHeader";
import { notFound } from "next/navigation";
import { BillingView } from "@/modules/smartbeak/billing/components/BillingView";

export default async function BillingPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const session = await getSession();
	const { organizationSlug } = await params;
	const org = await getActiveOrganization(organizationSlug);
	if (!org || !isOrganizationAdmin(org, session?.user)) {
		return notFound();
	}

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
