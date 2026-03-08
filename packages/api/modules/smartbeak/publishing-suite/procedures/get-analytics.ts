import { ORPCError } from "@orpc/server";
import { getDomainById } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getPublishAnalyticsProcedure = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/publishing-suite/analytics",
		tags: ["SmartBeak - Publishing Suite"],
		summary: "Get post-publish performance analytics per platform",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
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
		throw new ORPCError("PRECONDITION_FAILED", {
			message:
				"Publishing analytics is not available yet. Current platform adapters only persist publish IDs and URLs, not post-performance metrics like views, clicks, engagement, or impressions.",
		});
	});
