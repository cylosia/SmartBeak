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
import { protectedProcedure, publicProcedure, adminProcedure } from "../../../../orpc/procedures";

// ── get-my-referrals (auth) ───────────────────────────────────────────────────
export const getMyReferralsProcedure = protectedProcedure
  .input(z.object({ email: z.string().email() }))
  .handler(async ({ input }) => {
    const entry = await getWaitlistEntryByEmail(input.email);
    if (!entry) return { referrals: [], stats: null };
    const referrals = await getReferralsByReferrer(entry.id);
    const stats = await getReferralStats(entry.id);
    const referralLink = `${getBaseUrl()}/waitlist?ref=${entry.referralCode}`;
    return { referrals, stats, referralCode: entry.referralCode, referralLink };
  });

// ── complete-referral (internal / webhook) ────────────────────────────────────
export const completeReferralProcedure = adminProcedure
  .input(z.object({ referralCode: z.string().min(1), referredUserId: z.string().min(1) }))
  .handler(async ({ input }) => {
    const referral = await getReferralByCode(input.referralCode);
    if (!referral) throw new ORPCError("NOT_FOUND", { message: "Referral not found." });
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
  .input(z.object({ referralCode: z.string().min(1) }))
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
