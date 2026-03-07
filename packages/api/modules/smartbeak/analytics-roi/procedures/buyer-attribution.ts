import { ORPCError } from "@orpc/server";
import {
	createBuyerSession,
	getBuyerAttributionForDomain,
	getBuyerAttributionForOrg,
	getDomainById,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getBuyerAttributionDomain = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/analytics/buyer-attribution/domain",
		tags: ["SmartBeak - Analytics"],
		summary: "Get buyer attribution and conversion path for a domain",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			domainId: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);

		const domain = await getDomainById(input.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
		}

		const attribution = await getBuyerAttributionForDomain(input.domainId);
		return attribution;
	});

export const getBuyerAttributionOrg = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/analytics/buyer-attribution/org",
		tags: ["SmartBeak - Analytics"],
		summary: "Get buyer attribution across all domains in an organization",
	})
	.input(z.object({ organizationSlug: z.string().min(1) }))
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);

		const attribution = await getBuyerAttributionForOrg(org.id);
		return attribution;
	});

export const trackBuyerSession = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/analytics/buyer-attribution/track",
		tags: ["SmartBeak - Analytics"],
		summary: "Track a new buyer session for a domain",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			domainId: z.string().uuid(),
			sessionId: z.string().min(1),
			buyerEmail: z.string().email().optional(),
			intent: z.string().optional(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);

		const domain = await getDomainById(input.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
		}

		const session = await createBuyerSession({
			domainId: input.domainId,
			sessionId: input.sessionId,
			buyerEmail: input.buyerEmail,
			intent: input.intent,
		});

		const created = session[0];
		if (!created) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "Failed to create buyer session.",
			});
		}
		return { session: created };
	});
