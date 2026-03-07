/**
 * Enterprise Billing — Usage-based tier and seat management procedures.
 *
 * Covers:
 * - Listing available billing tiers
 * - Getting and setting an organization's current tier
 * - Updating seat counts
 * - Checking usage against tier limits (with overage detection)
 */

import { ORPCError } from "@orpc/server";
import type { EnterpriseTierLimits } from "@repo/database";
import {
	createOverageAlert,
	getActiveBillingTiers,
	getBillingTierById,
	getOrgTier,
	getOverageAlertsForOrg,
	getUsageRecordsForOrg,
	updateOrgSeats,
	upsertOrgTier,
} from "@repo/database";
import z from "zod";
import {
	cachedGetBillingTiers,
	cachedGetOrgTier,
	invalidateOrgCache,
} from "../../../../infrastructure/redis-cache";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgAdmin, requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const listBillingTiersProcedure = protectedProcedure
	.route({
		method: "GET",
		path: "/enterprise/billing/tiers",
		tags: ["Enterprise - Billing"],
		summary: "List all available billing tiers",
	})
	.input(z.object({}))
	.handler(async () => {
		const tiers = await cachedGetBillingTiers(() =>
			getActiveBillingTiers(),
		);
		return { tiers };
	});

export const getOrgTierProcedure = protectedProcedure
	.route({
		method: "GET",
		path: "/enterprise/billing/org-tier",
		tags: ["Enterprise - Billing"],
		summary:
			"Get the current billing tier and seat count for an organization",
	})
	.input(z.object({ organizationSlug: z.string().min(1) }))
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);

		const orgTier = await cachedGetOrgTier(org.id, () =>
			getOrgTier(org.id),
		);
		return { orgTier };
	});

export const setOrgTierProcedure = protectedProcedure
	.route({
		method: "PUT",
		path: "/enterprise/billing/org-tier",
		tags: ["Enterprise - Billing"],
		summary: "Set or change the billing tier for an organization",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			tierId: z.string().uuid(),
			seats: z.number().int().min(1, "At least 1 seat is required"),
			overageEnabled: z.boolean().default(false),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);

		const tier = await getBillingTierById(input.tierId);
		if (!tier || !tier.isActive) {
			throw new ORPCError("NOT_FOUND", {
				message: "Billing tier not found or is no longer available.",
			});
		}

		const orgTier = await upsertOrgTier({
			orgId: org.id,
			tierId: input.tierId,
			seats: input.seats,
			overageEnabled: input.overageEnabled,
		});

		await invalidateOrgCache(org.id, input.organizationSlug);

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.billing.tier.set",
			entityType: "enterprise_org_tier",
			entityId: orgTier.id,
			details: {
				tierId: input.tierId,
				tierName: tier.name,
				seats: input.seats,
			},
		});

		return { orgTier };
	});

export const updateSeatsProcedure = protectedProcedure
	.route({
		method: "PATCH",
		path: "/enterprise/billing/seats",
		tags: ["Enterprise - Billing"],
		summary: "Update the seat count for an organization",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			seats: z.number().int().min(1, "At least 1 seat is required"),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);

		const existing = await getOrgTier(org.id);
		if (!existing) {
			throw new ORPCError("NOT_FOUND", {
				message:
					"No billing tier configured for this organization. Please set a tier first.",
			});
		}

		const updated = await updateOrgSeats(org.id, input.seats);

		await invalidateOrgCache(org.id, input.organizationSlug);

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.billing.seats.updated",
			entityType: "enterprise_org_tier",
			entityId: existing.id,
			details: {
				previousSeats: existing.seats,
				newSeats: input.seats,
			},
		});

		return { orgTier: updated };
	});

export const getUsageWithLimitsProcedure = protectedProcedure
	.route({
		method: "GET",
		path: "/enterprise/billing/usage",
		tags: ["Enterprise - Billing"],
		summary:
			"Get current usage metrics against tier limits, with overage detection",
	})
	.input(z.object({ organizationSlug: z.string().min(1) }))
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);

		const [orgTier, usageRecords] = await Promise.all([
			getOrgTier(org.id),
			getUsageRecordsForOrg(org.id, { limit: 100 }),
		]);

		const limits = (orgTier?.tier?.limits ?? {
			seats: 5,
			domains: 10,
			contentItems: 500,
			storageGb: 10,
			aiIdeasPerMonth: 100,
			publishingJobsPerMonth: 200,
			apiCallsPerDay: 1000,
		}) as EnterpriseTierLimits;

		const metricLabels: Record<string, string> = {
			domains: "Domains",
			content_items: "Content Items",
			media_storage_gb: "Media Storage (GB)",
			ai_ideas: "AI Ideas / month",
			publishing_jobs: "Publishing Jobs / month",
			api_calls: "API Calls / day",
		};

		const limitMap: Record<string, number> = {
			domains: limits.domains,
			content_items: limits.contentItems,
			media_storage_gb: limits.storageGb,
			ai_ideas: limits.aiIdeasPerMonth,
			publishing_jobs: limits.publishingJobsPerMonth,
			api_calls: limits.apiCallsPerDay,
		};

		const usageWithLimits = Object.entries(limitMap).map(
			([metric, limit]) => {
				const record = usageRecords.find((r) => r.metric === metric);
				const used = record ? Number(record.value) : 0;
				const pct = limit <= 0 ? 0 : Math.round((used / limit) * 100);
				return {
					metric,
					label: metricLabels[metric] ?? metric,
					used,
					limit,
					unlimited: limit === -1,
					percentUsed: pct,
					isOverage: limit !== -1 && used > limit,
					isNearLimit: limit !== -1 && pct >= 80 && pct < 100,
				};
			},
		);

		const overageItems = usageWithLimits.filter((u) => u.isOverage);
		if (overageItems.length > 0) {
			const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
			const alertChecks = await Promise.all(
				overageItems.map((item) =>
					getOverageAlertsForOrg(org.id, item.metric, 1, oneDayAgo),
				),
			);
			const createPromises = overageItems
				.filter((_, i) => alertChecks[i]?.length === 0)
				.map((item) =>
					createOverageAlert({
						orgId: org.id,
						metric: item.metric,
						thresholdPercent: 100,
						usageValue: item.used,
						limitValue: item.limit,
					}),
				);
			await Promise.all(createPromises);
		}

		return {
			orgTier,
			usageWithLimits,
			seats: {
				licensed: orgTier?.seats ?? 1,
				tierName: orgTier?.tier?.displayName ?? "Starter",
			},
		};
	});
