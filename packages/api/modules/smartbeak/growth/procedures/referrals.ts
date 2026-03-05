import {
  completeReferral,
  getReferralByCode,
  getReferralsByReferrer,
  getReferralStats,
  getWaitlistEntryByEmail,
  grantReferralReward,
} from "@repo/database/drizzle/queries/growth";
import { GrantRewardInputSchema } from "@repo/database/drizzle/zod-growth";
import { z } from "zod";
import { protectedProcedure, publicProcedure, adminProcedure } from "../../../../orpc/procedures";

// ── get-my-referrals (auth) ───────────────────────────────────────────────────
export const getMyReferralsProcedure = protectedProcedure
  .input(z.object({ email: z.string().email() }))
  .handler(async ({ input }) => {
    const entry = await getWaitlistEntryByEmail(input.email);
    if (!entry) return { referrals: [], stats: null };
    const referrals = await getReferralsByReferrer(entry.id);
    const stats = await getReferralStats(entry.id);
    const referralLink = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://smartbeak.io"}/waitlist?ref=${entry.referralCode}`;
    return { referrals, stats, referralCode: entry.referralCode, referralLink };
  });

// ── complete-referral (internal / webhook) ────────────────────────────────────
export const completeReferralProcedure = adminProcedure
  .input(z.object({ referralCode: z.string(), referredUserId: z.string() }))
  .handler(async ({ input }) => {
    const referral = await getReferralByCode(input.referralCode);
    if (!referral) throw new Error("Referral not found");
    return completeReferral(referral.id, input.referredUserId);
  });

// ── grant-reward (admin) ──────────────────────────────────────────────────────
export const grantRewardProcedure = adminProcedure
  .input(GrantRewardInputSchema)
  .handler(async ({ input }) => {
    return grantReferralReward(input.referralId, input.rewardType, input.rewardValue);
  });

// ── get-referral-stats (public, by referral code) ─────────────────────────────
export const getReferralStatsByCodeProcedure = publicProcedure
  .input(z.object({ referralCode: z.string() }))
  .handler(async ({ input }) => {
    const { getWaitlistEntryByReferralCode } = await import("@repo/database/drizzle/queries/growth");
    const referrer = await getWaitlistEntryByReferralCode(input.referralCode);
    if (!referrer) return null;
    const stats = await getReferralStats(referrer.id);
    return {
      referralCode: input.referralCode,
      stats,
      referralLink: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://smartbeak.io"}/waitlist?ref=${input.referralCode}`,
    };
  });
