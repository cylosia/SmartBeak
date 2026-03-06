import { ORPCError } from "@orpc/server";
import {
	getDomainById,
	getPublishAnalyticsForDomain,
	getPublishingJobStatusSummary,
} from "@repo/database";
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

		const [rows, statusSummary] = await Promise.all([
			getPublishAnalyticsForDomain(input.domainId),
			getPublishingJobStatusSummary(input.domainId),
		]);

		// Aggregate per platform
		const byPlatform: Record<
			string,
			{
				views: number;
				engagement: number;
				clicks: number;
				impressions: number;
				posts: number;
			}
		> = {};
		for (const r of rows) {
			const t = r.target as string;
			if (!byPlatform[t]) {
				byPlatform[t] = {
					views: 0,
					engagement: 0,
					clicks: 0,
					impressions: 0,
					posts: 0,
				};
			}
			byPlatform[t].views += r.views;
			byPlatform[t].engagement += r.engagement;
			byPlatform[t].clicks += r.clicks;
			byPlatform[t].impressions += r.impressions;
			byPlatform[t].posts += 1;
		}

		// Totals
		const totals = Object.values(byPlatform).reduce(
			(acc, v) => ({
				views: acc.views + v.views,
				engagement: acc.engagement + v.engagement,
				clicks: acc.clicks + v.clicks,
				impressions: acc.impressions + v.impressions,
				posts: acc.posts + v.posts,
			}),
			{ views: 0, engagement: 0, clicks: 0, impressions: 0, posts: 0 },
		);

		return { rows, byPlatform, totals, statusSummary };
	});
