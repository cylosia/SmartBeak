/**
 * Centralized AI Budget Service
 *
 * Uses the existing `usageRecords` table to track monthly AI spend per org.
 * Reads the org's enterprise tier limits for the monthly cap, with a
 * hardcoded fallback of 2000 cents ($20).
 */

import { ORPCError } from "@orpc/server";
import {
	createUsageRecord,
	type EnterpriseTierLimits,
	getOrgTier,
	getUsageRecordsForOrg,
} from "@repo/database";
import { logger } from "@repo/logs";

const AI_SPEND_METRIC = "ai_spend_cents";
const DEFAULT_MONTHLY_CAP_CENTS = 2000;
const NEAR_LIMIT_THRESHOLD = 0.8;

function getCurrentMonthKey(): string {
	const now = new Date();
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function getMonthlySpend(orgId: string): Promise<number> {
	const records = await getUsageRecordsForOrg(orgId, {
		metric: AI_SPEND_METRIC,
		limit: 50,
	});

	const monthKey = getCurrentMonthKey();
	const thisMonthRecords = records.filter((r) => {
		const d = new Date(r.recordedAt);
		const rKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
		return rKey === monthKey;
	});

	return thisMonthRecords.reduce((sum, r) => sum + Number(r.value), 0);
}

async function getMonthlyCapCents(orgId: string): Promise<number> {
	try {
		const orgTier = await getOrgTier(orgId);
		if (orgTier?.tier?.limits) {
			const limits = orgTier.tier.limits as EnterpriseTierLimits;
			if (
				"aiSpendCapCents" in limits &&
				typeof (limits as Record<string, unknown>).aiSpendCapCents ===
					"number"
			) {
				const cap = (limits as Record<string, unknown>)
					.aiSpendCapCents as number;
				if (cap > 0) {
					return cap;
				}
				if (cap === -1) {
					return Number.MAX_SAFE_INTEGER;
				}
			}
		}
	} catch (err) {
		logger.warn(
			"[ai-budget] Failed to read org tier, using default cap",
			err,
		);
	}
	return DEFAULT_MONTHLY_CAP_CENTS;
}

/**
 * Checks whether the org is within its AI spend budget.
 * Throws PAYMENT_REQUIRED if the org has exceeded its monthly cap.
 */
export async function checkAiBudget(
	orgId: string,
	estimatedCostCents = 0,
): Promise<void> {
	const [spent, cap] = await Promise.all([
		getMonthlySpend(orgId),
		getMonthlyCapCents(orgId),
	]);

	if (spent + estimatedCostCents > cap) {
		throw new ORPCError("PAYMENT_REQUIRED", {
			message: `AI spend limit reached. Used ${(spent / 100).toFixed(2)} of ${(cap / 100).toFixed(2)} USD this month.`,
		});
	}
}

/**
 * Records AI spend by inserting a usage record for the current org.
 */
export async function recordAiSpend(
	orgId: string,
	costCents: number,
): Promise<void> {
	if (costCents <= 0) {
		return;
	}

	try {
		await createUsageRecord({
			orgId,
			metric: AI_SPEND_METRIC,
			value: Math.round(costCents),
		});
	} catch (err) {
		logger.error("[ai-budget] Failed to record AI spend", err);
	}
}

/**
 * Returns the current AI budget status for an org.
 */
export async function getAiBudgetStatus(orgId: string): Promise<{
	spent: number;
	cap: number;
	pctUsed: number;
	nearLimit: boolean;
	overLimit: boolean;
}> {
	const [spent, cap] = await Promise.all([
		getMonthlySpend(orgId),
		getMonthlyCapCents(orgId),
	]);

	const pctUsed = cap > 0 ? Math.round((spent / cap) * 100) : 0;

	return {
		spent,
		cap,
		pctUsed,
		nearLimit: pctUsed >= NEAR_LIMIT_THRESHOLD * 100,
		overLimit: spent >= cap,
	};
}
