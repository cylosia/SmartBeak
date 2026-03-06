import { ORPCError } from "@orpc/server";
import {
	getDomainById,
	getKeywordsByDomain,
	getOrgSeoOverview,
	getSeoDashboardSummary,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

/**
 * Daily SEO report.
 *
 * Returns a structured report for a domain or the full org,
 * suitable for email delivery or dashboard display.
 *
 * In production: schedule via Supabase Edge Functions cron
 * and deliver via Resend using the @repo/mail package.
 */
export const getSeoReport = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/seo-intelligence/report",
		tags: ["SmartBeak - SEO Intelligence"],
		summary: "Get daily SEO report for a domain or full org",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			domainId: z.string().uuid().optional(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);

		if (input.domainId) {
			// Domain-level report
			const domain = await getDomainById(input.domainId);
			if (!domain || domain.orgId !== org.id) {
				throw new ORPCError("NOT_FOUND", {
					message: "Domain not found.",
				});
			}

			const [summary, allKeywords] = await Promise.all([
				getSeoDashboardSummary(input.domainId),
				getKeywordsByDomain(input.domainId, { limit: 500 }),
			]);

			const top10 = allKeywords
				.filter((k) => k.position !== null && k.position <= 10)
				.slice(0, 10);

			const decaying = allKeywords
				.filter((k) => Number.parseFloat(k.decayFactor ?? "1") < 0.5)
				.slice(0, 10);

			const highVolume = [...allKeywords]
				.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
				.slice(0, 10);

			return {
				type: "domain" as const,
				domain: { id: domain.id, name: domain.name },
				generatedAt: new Date().toISOString(),
				summary,
				top10Keywords: top10,
				decayingKeywords: decaying,
				highVolumeKeywords: highVolume,
			};
		}
		// Org-level report
		const overview = await getOrgSeoOverview(org.id);

		return {
			type: "org" as const,
			org: { id: org.id, name: org.name },
			generatedAt: new Date().toISOString(),
			domains: overview,
			totalDomains: overview.length,
			avgSeoScore:
				overview.length > 0
					? Math.round(
							overview.reduce(
								(s, d) => s + (d.seoScore ?? 0),
								0,
							) / overview.length,
						)
					: 0,
			totalKeywords: overview.reduce(
				(s, d) => s + (d.keywordCount ?? 0),
				0,
			),
			totalDecaying: overview.reduce(
				(s, d) => s + (d.decayingCount ?? 0),
				0,
			),
		};
	});
