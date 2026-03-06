import {
  createReferral,
  createWaitlistEntry,
  getWaitlistEntryByEmail,
  getWaitlistEntryByReferralCode,
  getReferralLeaderboard,
  getWaitlistStats,
  listWaitlistEntries,
  updateWaitlistEntryStatus,
} from "@repo/database";
import { JoinWaitlistInputSchema, WaitlistStatusUpdateInputSchema } from "@repo/database";
import { ORPCError } from "@orpc/server";
import { logger } from "@repo/logs";
import { sendEmail } from "@repo/mail";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { getBaseUrl } from "@repo/utils";
import { publicProcedure, protectedProcedure, adminProcedure } from "../../../../orpc/procedures";

function generateReferralCode(email: string): string {
  const prefix = email.split("@")[0]!.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();
  const suffix = randomBytes(4).toString("hex").slice(0, 5).toUpperCase();
  return `${prefix}-${suffix}`;
}

// ── join-waitlist (public) ────────────────────────────────────────────────────
export const joinWaitlistProcedure = publicProcedure
  .route({ method: "POST", path: "/smartbeak/growth/waitlist/join", tags: ["SmartBeak - Growth"], summary: "Join the waitlist" })
  .input(JoinWaitlistInputSchema)
  .handler(async ({ input }) => {
    const { email, referredBy, firstName, lastName, company, useCase } = input;

    // Idempotent: return existing entry if already on waitlist
    const existing = await getWaitlistEntryByEmail(email);
    if (existing) {
      return {
        success: true,
        alreadyJoined: true,
        referralCode: existing.referralCode,
        referralLink: `${getBaseUrl()}/waitlist?ref=${existing.referralCode}`,
        position: null,
      };
    }

    // Validate referral code if provided
    let referrerEntry = null;
    if (referredBy) {
      referrerEntry = await getWaitlistEntryByReferralCode(referredBy);
    }

    const referralCode = generateReferralCode(email);
    const entry = await createWaitlistEntry({
      email,
      referralCode,
      referredBy: referrerEntry ? referredBy : undefined,
      firstName,
      lastName,
      company,
      useCase,
    });

    // Create a referral record for the referrer
    if (referrerEntry) {
      await createReferral({
        referrerId: referrerEntry.id,
        referredEmail: email,
        referralCode: referredBy!,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      });
    }

    const referralLink = `${getBaseUrl()}/waitlist?ref=${referralCode}`;

    // Send confirmation email
    try {
      await sendEmail({
        to: email,
        subject: "You're on the SmartBeak waitlist! 🎉",
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
            <h1 style="font-size: 24px; font-weight: 700; color: #0f172a;">Welcome to SmartBeak${firstName ? `, ${firstName}` : ""}!</h1>
            <p style="color: #475569; font-size: 16px; line-height: 1.6;">
              You're officially on the waitlist for SmartBeak — the AI-powered content publishing platform built for serious domain portfolio owners.
            </p>
            <p style="color: #475569; font-size: 16px; line-height: 1.6;">
              <strong>Move up the queue faster</strong> by sharing your referral link with others:
            </p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="margin: 0; font-size: 14px; color: #64748b;">Your referral link:</p>
              <a href="${referralLink}" style="color: #6366f1; font-weight: 600; word-break: break-all;">${referralLink}</a>
            </div>
            <p style="color: #475569; font-size: 14px;">
              Each successful referral moves you up the priority queue. Refer 3+ people to get early access.
            </p>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 32px;">
              The SmartBeak Team
            </p>
          </div>
        `,
        text: `Welcome to SmartBeak! Your referral link: ${referralLink}`,
      });
    } catch (err) {
      logger.warn("[waitlist] Failed to send confirmation email:", (err as Error).message);
    }

    return {
      success: true,
      alreadyJoined: false,
      referralCode,
      referralLink,
      position: null,
    };
  });

// ── get-waitlist-status (public, by email) ────────────────────────────────────
export const getWaitlistStatusProcedure = publicProcedure
  .route({ method: "GET", path: "/smartbeak/growth/waitlist/status", tags: ["SmartBeak - Growth"], summary: "Get waitlist status by email" })
  .input(z.object({ email: z.string().email() }))
  .handler(async ({ input }) => {
    const entry = await getWaitlistEntryByEmail(input.email);
    if (!entry) return null;
    const referralLink = `${getBaseUrl()}/waitlist?ref=${entry.referralCode}`;
    return {
      id: entry.id,
      status: entry.status,
      referralCode: entry.referralCode,
      referralLink,
      joinedAt: entry.joinedAt,
    };
  });

// ── admin: list-waitlist ──────────────────────────────────────────────────────
export const listWaitlistProcedure = adminProcedure
  .route({ method: "GET", path: "/smartbeak/growth/waitlist", tags: ["SmartBeak - Growth"], summary: "List waitlist entries (admin)" })
  .input(
    z.object({
      status: z.enum(["pending", "approved", "rejected", "converted"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ input }) => {
    const entries = await listWaitlistEntries({
      status: input.status,
      limit: input.limit,
      offset: input.offset,
    });
    const stats = await getWaitlistStats();
    return { entries, stats };
  });

// ── admin: update-waitlist-status ─────────────────────────────────────────────
export const updateWaitlistStatusProcedure = adminProcedure
  .route({ method: "PATCH", path: "/smartbeak/growth/waitlist/status", tags: ["SmartBeak - Growth"], summary: "Update waitlist entry status (admin)" })
  .input(WaitlistStatusUpdateInputSchema)
  .handler(async ({ input }) => {
    const entry = await updateWaitlistEntryStatus(input.id, input.status);
    if (!entry) throw new ORPCError("NOT_FOUND", { message: "Waitlist entry not found." });

    // Send approval email
    if (input.status === "approved") {
      try {
        await sendEmail({
          to: entry.email,
          subject: "You've been approved for SmartBeak early access! 🚀",
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
              <h1 style="font-size: 24px; font-weight: 700; color: #0f172a;">You're in${entry.firstName ? `, ${entry.firstName}` : ""}!</h1>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">
                Great news — you've been approved for early access to SmartBeak. Your account is ready.
              </p>
              <a href="${getBaseUrl()}/auth/signup"
                 style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
                Create Your Account →
              </a>
              <p style="color: #94a3b8; font-size: 12px; margin-top: 32px;">The SmartBeak Team</p>
            </div>
          `,
          text: `You've been approved! Sign up at: ${getBaseUrl()}/auth/signup`,
        });
      } catch (err) {
        logger.warn("[waitlist] Failed to send approval email:", (err as Error).message);
      }
    }

    return entry;
  });

// ── get-waitlist-stats (admin) ────────────────────────────────────────────────
export const getWaitlistStatsProcedure = adminProcedure
  .route({ method: "GET", path: "/smartbeak/growth/waitlist/stats", tags: ["SmartBeak - Growth"], summary: "Get waitlist statistics (admin)" })
  .input(z.object({}))
  .handler(async () => {
    const stats = await getWaitlistStats();
    const leaderboard = await getReferralLeaderboard(10);
    return { stats, leaderboard };
  });
