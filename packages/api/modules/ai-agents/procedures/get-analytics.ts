/**
 * Phase 3B — AI Agent Analytics Procedures
 *
 * orpc procedures for fetching agent usage, performance, and cost analytics.
 */

import {
  getAgentAnalytics,
} from "@repo/database";
import { GetAnalyticsInputSchema } from "@repo/database";
import { protectedProcedure } from "../../../orpc/procedures";
import { requireOrgMembership } from "../../smartbeak/lib/membership";
import { resolveSmartBeakOrg } from "../../smartbeak/lib/resolve-org";

export const getAgentAnalyticsProcedure = protectedProcedure
  .route({
    method: "GET",
    path: "/ai-agents/analytics",
    tags: ["AI Agents"],
    summary: "Get agent usage, performance, and cost analytics for an organization",
  })
  .input(GetAnalyticsInputSchema)
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);

    const startDate = input.startDate ? new Date(input.startDate) : undefined;
    const endDate = input.endDate ? new Date(input.endDate) : undefined;

    const analytics = await getAgentAnalytics(org.id, { startDate, endDate });

    // Format cost from cents to dollars for display
    const totalCostUsd =
      Number(analytics.totals.totalCostCents ?? 0) / 100;
    const successRate =
      Number(analytics.totals.totalSessions) > 0
        ? (Number(analytics.totals.completedCount) /
            Number(analytics.totals.totalSessions)) *
          100
        : 0;

    return {
      summary: {
        totalSessions: Number(analytics.totals.totalSessions ?? 0),
        totalCostUsd: Math.round(totalCostUsd * 100) / 100,
        totalInputTokens: Number(analytics.totals.totalInputTokens ?? 0),
        totalOutputTokens: Number(analytics.totals.totalOutputTokens ?? 0),
        avgDurationMs: Math.round(
          Number(analytics.totals.avgDurationMs ?? 0),
        ),
        successRate: Math.round(successRate * 10) / 10,
        completedCount: Number(analytics.totals.completedCount ?? 0),
        failedCount: Number(analytics.totals.failedCount ?? 0),
      },
      workflowBreakdown: analytics.workflowBreakdown.map((w) => ({
        workflowId: w.workflowId,
        workflowName: w.workflowName ?? "Ad-hoc",
        sessionCount: Number(w.sessionCount ?? 0),
        totalCostUsd: Math.round(Number(w.totalCostCents ?? 0)) / 100,
        avgDurationMs: Math.round(Number(w.avgDurationMs ?? 0)),
      })),
      dailyTrend: analytics.dailyTrend.map((d) => ({
        date: d.date,
        sessionCount: Number(d.sessionCount ?? 0),
        costUsd: Math.round(Number(d.costCents ?? 0)) / 100,
      })),
    };
  });
