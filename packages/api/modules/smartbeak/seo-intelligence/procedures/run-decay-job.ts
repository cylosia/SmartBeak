import { ORPCError } from "@orpc/server";
import {
  getStaleKeywords,
  recalculateDecayFactor,
} from "@repo/database";
import z from "zod";
import { adminProcedure } from "../../../../orpc/procedures";

/**
 * Background decay job.
 *
 * This procedure is intended to be called by a cron job or Supabase Edge Function
 * on a daily schedule. It:
 *   1. Fetches all keywords not updated in the last 24 hours.
 *   2. Recalculates the decay factor for each.
 *   3. Returns a summary of keywords that have decayed below thresholds.
 *
 * In production, integrate with Resend or your mail provider to send
 * decay alert emails to org owners when keywords fall below 0.5.
 *
 * Trigger via: POST /api/smartbeak/seo-intelligence/jobs/decay
 * Secure with: adminProcedure (requires admin role on the Supastarter user)
 * Or: call from a Supabase Edge Function with a service role key.
 */
export const runDecayJob = adminProcedure
  .route({
    method: "POST",
    path: "/smartbeak/seo-intelligence/jobs/decay",
    tags: ["SmartBeak - SEO Intelligence"],
    summary: "Background job: recalculate keyword decay factors and generate alerts",
  })
  .input(
    z.object({
      olderThanHours: z.number().int().min(1).max(168).default(24),
      dryRun: z.boolean().default(false),
    }),
  )
  .handler(async ({ input }) => {
    const staleKeywords = await getStaleKeywords(input.olderThanHours);

    if (staleKeywords.length === 0) {
      return {
        processed: 0,
        criticalAlerts: [],
        warningAlerts: [],
        dryRun: input.dryRun,
      };
    }

    const criticalAlerts: Array<{ id: string; keyword: string; decayFactor: string }> = [];
    const warningAlerts: Array<{ id: string; keyword: string; decayFactor: string }> = [];

    if (!input.dryRun) {
      for (const kw of staleKeywords) {
        const [updated] = await recalculateDecayFactor(kw.id, kw.lastUpdated);
        const decay = parseFloat(updated.decayFactor ?? "1");

        if (decay < 0.3) {
          criticalAlerts.push({
            id: updated.id,
            keyword: updated.keyword,
            decayFactor: updated.decayFactor ?? "0",
          });
        } else if (decay < 0.5) {
          warningAlerts.push({
            id: updated.id,
            keyword: updated.keyword,
            decayFactor: updated.decayFactor ?? "0",
          });
        }
      }
    } else {
      // Dry run: compute without persisting
      for (const kw of staleKeywords) {
        const daysSince =
          (Date.now() - kw.lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
        const decay = Math.max(0, Math.min(1, 1 - daysSince / 30));
        const decayFactor = decay.toFixed(4);

        if (decay < 0.3) {
          criticalAlerts.push({ id: kw.id, keyword: kw.keyword, decayFactor });
        } else if (decay < 0.5) {
          warningAlerts.push({ id: kw.id, keyword: kw.keyword, decayFactor });
        }
      }
    }

    return {
      processed: staleKeywords.length,
      criticalAlerts,
      warningAlerts,
      dryRun: input.dryRun,
    };
  });
