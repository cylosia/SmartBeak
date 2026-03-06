/**
 * SmartBeak Phase 2D — Growth & Marketing Zod schemas
 */

import { z } from "zod";

// ─── Waitlist ─────────────────────────────────────────────────────────────────

export const WaitlistStatusSchema = z.enum([
	"pending",
	"approved",
	"rejected",
	"converted",
]);

export const WaitlistEntrySchema = z.object({
	id: z.string().uuid(),
	email: z.string().email(),
	referralCode: z.string(),
	referredBy: z.string().nullable(),
	status: WaitlistStatusSchema,
	position: z.string().nullable(),
	firstName: z.string().nullable(),
	lastName: z.string().nullable(),
	company: z.string().nullable(),
	useCase: z.string().nullable(),
	joinedAt: z.date(),
	approvedAt: z.date().nullable(),
	convertedAt: z.date().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const JoinWaitlistInputSchema = z.object({
	email: z.string().email("Please enter a valid email address"),
	referredBy: z.string().optional(),
	firstName: z.string().max(100).optional(),
	lastName: z.string().max(100).optional(),
	company: z.string().max(200).optional(),
	useCase: z.string().max(500).optional(),
});

export const WaitlistStatsSchema = z.object({
	total: z.number(),
	pending: z.number(),
	approved: z.number(),
	rejected: z.number(),
	converted: z.number(),
});

export const WaitlistStatusUpdateInputSchema = z.object({
	id: z.string().uuid(),
	status: WaitlistStatusSchema,
});

export const WaitlistLeaderboardEntrySchema = z.object({
	referredBy: z.string().nullable(),
	referralCount: z.number(),
	email: z.string().email().optional(),
});

// ─── Referrals ────────────────────────────────────────────────────────────────

export const ReferralStatusSchema = z.enum([
	"pending",
	"completed",
	"rewarded",
	"expired",
]);

export const ReferralSchema = z.object({
	id: z.string().uuid(),
	referrerId: z.string(),
	referredUserId: z.string().nullable(),
	referredEmail: z.string().email(),
	referralCode: z.string(),
	status: ReferralStatusSchema,
	rewardGranted: z.boolean(),
	rewardType: z.string().nullable(),
	rewardValue: z.string().nullable(),
	rewardGrantedAt: z.date().nullable(),
	completedAt: z.date().nullable(),
	expiresAt: z.date().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const ReferralStatsSchema = z.object({
	total: z.number(),
	pending: z.number(),
	completed: z.number(),
	rewarded: z.number(),
	expired: z.number(),
});

export const GrantRewardInputSchema = z.object({
	referralId: z.string().uuid(),
	rewardType: z.enum(["credits", "extra_domain", "plan_upgrade"]),
	rewardValue: z.string(),
});

// ─── Onboarding Email Sequences ───────────────────────────────────────────────

export const OnboardingEmailStepSchema = z.object({
	step: z.number().int().min(1).max(10),
	subject: z.string(),
	delayDays: z.number().int().min(0),
	templateKey: z.string(),
});

export const WaitlistConfirmationDataSchema = z.object({
	email: z.string().email(),
	firstName: z.string().optional(),
	referralCode: z.string(),
	referralLink: z.string().url(),
	position: z.number().int().optional(),
	referralCount: z.number().int().default(0),
});

export const ReferralShareDataSchema = z.object({
	referralCode: z.string(),
	referralLink: z.string().url(),
	referralCount: z.number().int(),
	rewardedCount: z.number().int(),
});
