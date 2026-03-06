/**
 * SmartBeak Phase 2D — Growth & Marketing DB queries
 * Covers: waitlist_entries, referrals
 */

import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { referrals, waitlistEntries } from "../schema/growth";

// ─── Waitlist ─────────────────────────────────────────────────────────────────

export async function getWaitlistEntryByEmail(email: string) {
	const rows = await db
		.select()
		.from(waitlistEntries)
		.where(eq(waitlistEntries.email, email))
		.limit(1);
	return rows[0] ?? null;
}

export async function getWaitlistEntryByReferralCode(code: string) {
	const rows = await db
		.select()
		.from(waitlistEntries)
		.where(eq(waitlistEntries.referralCode, code))
		.limit(1);
	return rows[0] ?? null;
}

export async function getWaitlistEntryById(id: string) {
	const rows = await db
		.select()
		.from(waitlistEntries)
		.where(eq(waitlistEntries.id, id))
		.limit(1);
	return rows[0] ?? null;
}

export async function createWaitlistEntry(data: {
	email: string;
	referralCode: string;
	referredBy?: string;
	firstName?: string;
	lastName?: string;
	company?: string;
	useCase?: string;
}) {
	const rows = await db
		.insert(waitlistEntries)
		.values({
			email: data.email,
			referralCode: data.referralCode,
			referredBy: data.referredBy ?? null,
			firstName: data.firstName ?? null,
			lastName: data.lastName ?? null,
			company: data.company ?? null,
			useCase: data.useCase ?? null,
			status: "pending",
		})
		.returning();
	return rows[0] as (typeof rows)[number];
}

export async function updateWaitlistEntryStatus(
	id: string,
	status: "pending" | "approved" | "rejected" | "converted",
) {
	const rows = await db
		.update(waitlistEntries)
		.set({
			status,
			approvedAt: status === "approved" ? new Date() : undefined,
			convertedAt: status === "converted" ? new Date() : undefined,
			updatedAt: new Date(),
		})
		.where(eq(waitlistEntries.id, id))
		.returning();
	return rows[0] ?? null;
}

export async function listWaitlistEntries(opts?: {
	status?: "pending" | "approved" | "rejected" | "converted";
	limit?: number;
	offset?: number;
}) {
	const conditions = [];
	if (opts?.status) {
		conditions.push(eq(waitlistEntries.status, opts.status));
	}
	const query = db
		.select()
		.from(waitlistEntries)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(waitlistEntries.joinedAt))
		.limit(opts?.limit ?? 100)
		.offset(opts?.offset ?? 0);
	return query;
}

export async function getWaitlistStats() {
	const rows = await db
		.select({
			status: waitlistEntries.status,
			total: count(),
		})
		.from(waitlistEntries)
		.groupBy(waitlistEntries.status);

	const stats = {
		total: 0,
		pending: 0,
		approved: 0,
		rejected: 0,
		converted: 0,
	};
	for (const row of rows) {
		const n = Number(row.total);
		stats.total += n;
		stats[row.status] = n;
	}
	return stats;
}

export async function getReferralLeaderboard(limit = 10) {
	const rows = await db
		.select({
			referredBy: waitlistEntries.referredBy,
			referralCount: count(),
		})
		.from(waitlistEntries)
		.where(sql`${waitlistEntries.referredBy} IS NOT NULL`)
		.groupBy(waitlistEntries.referredBy)
		.orderBy(desc(count()))
		.limit(limit);
	return rows;
}

// ─── Referrals ────────────────────────────────────────────────────────────────

export async function createReferral(data: {
	referrerId: string;
	referredEmail: string;
	referralCode: string;
	expiresAt?: Date;
}) {
	const rows = await db
		.insert(referrals)
		.values({
			referrerId: data.referrerId,
			referredEmail: data.referredEmail,
			referralCode: data.referralCode,
			status: "pending",
			rewardGranted: false,
			expiresAt: data.expiresAt ?? null,
		})
		.returning();
	return rows[0] as (typeof rows)[number];
}

export async function getReferralsByReferrer(referrerId: string) {
	return db
		.select()
		.from(referrals)
		.where(eq(referrals.referrerId, referrerId))
		.orderBy(desc(referrals.createdAt))
		.limit(200);
}

export async function getReferralByCode(code: string) {
	const rows = await db
		.select()
		.from(referrals)
		.where(eq(referrals.referralCode, code))
		.limit(1);
	return rows[0] ?? null;
}

export async function completeReferral(id: string, referredUserId: string) {
	const rows = await db
		.update(referrals)
		.set({
			referredUserId,
			status: "completed",
			completedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(referrals.id, id))
		.returning();
	return rows[0] ?? null;
}

export async function grantReferralReward(
	id: string,
	rewardType: string,
	rewardValue: string,
) {
	const rows = await db
		.update(referrals)
		.set({
			status: "rewarded",
			rewardGranted: true,
			rewardType,
			rewardValue,
			rewardGrantedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(referrals.id, id))
		.returning();
	return rows[0] ?? null;
}

export async function getReferralStats(referrerId: string) {
	const rows = await db
		.select({
			status: referrals.status,
			total: count(),
		})
		.from(referrals)
		.where(eq(referrals.referrerId, referrerId))
		.groupBy(referrals.status);

	const stats = {
		total: 0,
		pending: 0,
		completed: 0,
		rewarded: 0,
		expired: 0,
	};
	for (const row of rows) {
		const n = Number(row.total);
		stats.total += n;
		const statusKey = row.status as keyof typeof stats;
		if (statusKey in stats) {
			stats[statusKey] = n;
		}
	}
	return stats;
}
