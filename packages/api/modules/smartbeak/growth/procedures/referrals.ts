import {
  completeReferral,
  getReferralByCode,
  getReferralsByReferrer,
  getReferralStats,
  getWaitlistEntryByEmail,
  getWaitlistEntryByReferralCode,
  grantReferralReward,
} from "@repo/database";
import { GrantRewardInputSchema } from "@repo/database";
import { ORPCError } from "@orpc/server";
import { getBaseUrl } from "@repo/utils";
import { z } from "zod";
import { publicRateLimitMiddleware } from "../../../../orpc/middleware/rate-limit-middleware";
import { protectedProcedure, publicProcedure, adminProcedure } from "../../../../orpc/procedures";

// ── get-my-referrals (auth) ───────────────────────────────────────────────────
export const getMyReferralsProcedure = protectedProcedure
  .route({ method: "GET", path: "/smartbeak/growth/referrals/mine", tags: ["SmartBeak - Growth"], summary: "Get my referrals" })
  .input(z.object({ email: z.string().email() }))
  .handler(async ({ input, context }) => {
    if (context.user.email !== input.email) {
      throw new ORPCError("FORBIDDEN", { message: "Access denied." });
    }
    const entry = await getWaitlistEntryByEmail(input.email);
    if (!entry) return { referrals: [], stats: null };
    const referrals = await getReferralsByReferrer(entry.id);
    const stats = await getReferralStats(entry.id);
    const referralLink = `${getBaseUrl()}/waitlist?ref=${entry.referralCode}`;
    return { referrals, stats, referralCode: entry.referralCode, referralLink };
  });

// ── complete-referral (internal / webhook) ────────────────────────────────────
export const completeReferralProcedure = adminProcedure
  .route({ method: "POST", path: "/smartbeak/growth/referrals/complete", tags: ["SmartBeak - Growth"], summary: "Complete a referral (admin)" })
  .input(z.object({ referralCode: z.string().min(1), referredUserId: z.string().min(1) }))
  .handler(async ({ input }) => {
    const referral = await getReferralByCode(input.referralCode);
    if (!referral) throw new ORPCError("NOT_FOUND", { message: "Referral not found." });
    const completed = await completeReferral(referral.id, input.referredUserId);
    if (!completed) throw new ORPCError("NOT_FOUND", { message: "Referral could not be completed." });
    return completed;
  });

// ── grant-reward (admin) ──────────────────────────────────────────────────────
export const grantRewardProcedure = adminProcedure
  .route({ method: "POST", path: "/smartbeak/growth/referrals/reward", tags: ["SmartBeak - Growth"], summary: "Grant a referral reward (admin)" })
  .input(GrantRewardInputSchema)
  .handler(async ({ input }) => {
    const rewarded = await grantReferralReward(input.referralId, input.rewardType, input.rewardValue);
    if (!rewarded) throw new ORPCError("NOT_FOUND", { message: "Referral not found." });
    return rewarded;
  });

// ── get-referral-stats (public, by referral code) ─────────────────────────────
export const getReferralStatsByCodeProcedure = publicProcedure
  .route({ method: "GET", path: "/smartbeak/growth/referrals/stats", tags: ["SmartBeak - Growth"], summary: "Get referral stats by code" })
  .input(z.object({ referralCode: z.string().min(1).max(64) }))
  .use(publicRateLimitMiddleware({ limit: 15, windowMs: 60_000 }))
  .handler(async ({ input }) => {
    const referrer = await getWaitlistEntryByReferralCode(input.referralCode);
    if (!referrer) return null;
    const stats = await getReferralStats(referrer.id);
    return {
      referralCode: input.referralCode,
      stats,
      referralLink: `${getBaseUrl()}/waitlist?ref=${input.referralCode}`,
    };
  });
