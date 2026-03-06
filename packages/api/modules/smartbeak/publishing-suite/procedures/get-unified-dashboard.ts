import {
	getPublishingJobStatusSummaryForOrg,
	getPublishingJobsForOrg,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getUnifiedDashboardProcedure = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/publishing-suite/dashboard",
		tags: ["SmartBeak - Publishing Suite"],
		summary: "Get unified publishing dashboard for an org",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			limit: z.number().int().min(1).max(200).default(100),
			offset: z.number().int().min(0).default(0),
			status: z.string().optional(),
			target: z.string().optional(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);

		const [jobs, statusSummary] = await Promise.all([
			getPublishingJobsForOrg(org.id, {
				limit: input.limit,
				offset: input.offset,
				status: input.status,
				target: input.target,
			}),
			getPublishingJobStatusSummaryForOrg(org.id),
		]);

		// Build summary metrics
		const totals = {
			total: 0,
			pending: 0,
			running: 0,
			published: 0,
			failed: 0,
			cancelled: 0,
		};
		const statusKeys = new Set<string>([
			"pending",
			"running",
			"published",
			"failed",
			"cancelled",
		]);
		for (const row of statusSummary) {
			const s = row.status as string;
			totals.total += row.n;
			if (statusKeys.has(s)) {
				(totals as Record<string, number>)[s] += row.n;
			}
		}

		// Per-platform breakdown
		const byPlatform: Record<
			string,
			{ total: number; published: number; failed: number }
		> = {};
		for (const row of statusSummary) {
			const t = row.target as string;
			if (!byPlatform[t]) {
				byPlatform[t] = { total: 0, published: 0, failed: 0 };
			}
			byPlatform[t].total += row.n;
			if (row.status === "published") {
				byPlatform[t].published += row.n;
			}
			if (row.status === "failed") {
				byPlatform[t].failed += row.n;
			}
		}

		return { jobs, totals, byPlatform };
	});
