import {
  getPortfolioRoiForOrg,
  getPortfolioRoiMaterializedView,
  upsertPortfolioSummary,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getPortfolioRoi = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/analytics/portfolio-roi",
    tags: ["SmartBeak - Analytics"],
    summary: "Get risk-adjusted portfolio ROI with domain breakdown",
  })
  .input(z.object({ organizationSlug: z.string().min(1) }))
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);

    // Try materialized view first for speed
    const cached = await getPortfolioRoiMaterializedView(org.id);

    // Always compute live data
    const live = await getPortfolioRoiForOrg(org.id);

    // Persist updated summary
    if (live.totalDomains > 0) {
      await upsertPortfolioSummary({
        orgId: org.id,
        totalDomains: live.totalDomains,
        totalValue: live.totalValue.toFixed(2),
        avgRoi: live.avgRoi.toFixed(2),
      }).catch((err) => {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[portfolio-roi] Failed to upsert summary:", err);
      }
      return null;
    }); // non-blocking
    }

    return { ...live, cached };
  });

export const getPortfolioTrendData = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/analytics/portfolio-trend",
    tags: ["SmartBeak - Analytics"],
    summary: "Get portfolio decay trend over time",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      days: z.coerce.number().int().min(7).max(365).default(30),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const { getPortfolioTrend } = await import("@repo/database");
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);
    const trend = await getPortfolioTrend(org.id, input.days);
    return { trend };
  });
