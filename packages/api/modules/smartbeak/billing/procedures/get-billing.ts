import {
	getInvoicesForOrg,
	getSubscriptionForOrg,
	getUsageRecordsForOrg,
} from "@repo/database";
import z from "zod";
import { cachedGetSubscription } from "../../../../infrastructure/redis-cache";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getBilling = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/billing",
		tags: ["SmartBeak - Billing"],
		summary: "Get billing overview: subscription, invoices, and usage",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);
		const [subscription, invoices, usageRecords] = await Promise.all([
			cachedGetSubscription(org.id, () => getSubscriptionForOrg(org.id)),
			getInvoicesForOrg(org.id, { limit: 10 }),
			getUsageRecordsForOrg(org.id, { limit: 50 }),
		]);
		return { subscription, invoices, usageRecords };
	});
