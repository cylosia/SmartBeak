import { getMonetizationDecayForOrg, getPortfolioTrend } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getMonetizationDecayView = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/analytics/monetization-decay",
    tags: ["SmartBeak - Analytics"],
    summary: "Get monetization decay analytics for all domains in an org",
  })
  .input(z.object({ organizationSlug: z.string().min(1) }))
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);

    const data = await getMonetizationDecayForOrg(org.id);
    return { domains: data };
  });

export const getPortfolioTrendView = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/analytics/portfolio-trend",
    tags: ["SmartBeak - Analytics"],
    summary: "Get portfolio performance trend over time",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      days: z.coerce.number().int().min(7).max(365).default(30),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);

    const trend = await getPortfolioTrend(org.id, input.days);
    return { trend };
  });

export const getAnalyticsOverview = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/analytics/overview",
    tags: ["SmartBeak - Analytics"],
    summary: "Get a full analytics overview for an organization",
  })
  .input(z.object({ organizationSlug: z.string().min(1) }))
  .handler(async ({ context: { user }, input }) => {
    const { getPortfolioRoiForOrg, getBuyerAttributionForOrg } = await import("@repo/database");
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);

    const [roi, decay, attribution] = await Promise.all([
      getPortfolioRoiForOrg(org.id),
      getMonetizationDecayForOrg(org.id),
      getBuyerAttributionForOrg(org.id),
    ]);

    // Compute portfolio health index (0–100)
    const avgHealth =
      roi.domains.length > 0
        ? roi.domains.reduce((sum, d) => sum + (d.healthScore ?? 0), 0) / roi.domains.length
        : 0;

    const avgDecayAll =
      decay.length > 0
        ? decay.reduce((sum, d) => sum + d.avgDecay, 0) / decay.length
        : 1;

    const portfolioHealthIndex = Math.round(avgHealth * 0.6 + avgDecayAll * 100 * 0.4);

    return {
      roi,
      decay,
      attribution,
      portfolioHealthIndex,
    };
  });
