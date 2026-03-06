/**
 * SmartBeak Phase 3A — Enterprise Readiness & Scaling DB query functions.
 *
 * All queries use the additive enterprise schema from enterprise.ts.
 * The locked v9 smartbeak.ts schema is not modified.
 */

import { and, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { db } from "../client";

function escapeLikePattern(pattern: string): string {
	return pattern.replace(/[%_\\]/g, "\\$&");
}

import {
	enterpriseAuditRetention,
	enterpriseBillingTiers,
	enterpriseOrgTier,
	enterpriseOverageAlerts,
	enterpriseScimTokens,
	enterpriseSsoProviders,
	enterpriseTeamActivity,
	enterpriseTeamMembers,
	enterpriseTeams,
} from "../schema/enterprise";
import { auditEvents } from "../schema/smartbeak";

// ─── Teams ────────────────────────────────────────────────────────────────────

export async function getTeamsForOrg(orgId: string) {
	return db.query.enterpriseTeams.findMany({
		where: (t, { eq }) => eq(t.orgId, orgId),
		with: {
			members: { limit: 50 },
		},
		orderBy: (t, { asc }) => [asc(t.name)],
		limit: 100,
	});
}

export async function getTeamById(teamId: string) {
	return db.query.enterpriseTeams.findFirst({
		where: (t, { eq }) => eq(t.id, teamId),
		with: {
			members: true,
		},
	});
}

export async function getTeamBySlug(orgId: string, slug: string) {
	return db.query.enterpriseTeams.findFirst({
		where: (t, { and, eq }) => and(eq(t.orgId, orgId), eq(t.slug, slug)),
	});
}

export async function createTeam(data: {
	orgId: string;
	name: string;
	slug: string;
	description?: string;
	createdBy: string;
}) {
	const rows = await db
		.insert(enterpriseTeams)
		.values({
			orgId: data.orgId,
			name: data.name,
			slug: data.slug,
			description: data.description ?? null,
			createdBy: data.createdBy,
		})
		.returning();
	return rows[0] as (typeof rows)[number];
}

export async function updateTeam(
	teamId: string,
	data: {
		name?: string;
		description?: string | null;
		settings?: Record<string, unknown>;
	},
) {
	const rows = await db
		.update(enterpriseTeams)
		.set({
			...(data.name !== undefined && { name: data.name }),
			...(data.description !== undefined && {
				description: data.description,
			}),
			...(data.settings !== undefined && { settings: data.settings }),
			updatedAt: new Date(),
		})
		.where(eq(enterpriseTeams.id, teamId))
		.returning();
	return rows[0] ?? null;
}

export async function deleteTeam(teamId: string) {
	await db.delete(enterpriseTeams).where(eq(enterpriseTeams.id, teamId));
}

// ─── Team Members ─────────────────────────────────────────────────────────────

export async function getTeamMembers(teamId: string) {
	return db.query.enterpriseTeamMembers.findMany({
		where: (m, { eq }) => eq(m.teamId, teamId),
		orderBy: (m, { asc }) => [asc(m.createdAt)],
		limit: 200,
	});
}

export async function getTeamMember(teamId: string, userId: string) {
	return db.query.enterpriseTeamMembers.findFirst({
		where: (m, { and, eq }) =>
			and(eq(m.teamId, teamId), eq(m.userId, userId)),
	});
}

export async function addTeamMember(data: {
	teamId: string;
	userId: string;
	role: "admin" | "member";
	invitedBy?: string;
}) {
	const rows = await db
		.insert(enterpriseTeamMembers)
		.values({
			teamId: data.teamId,
			userId: data.userId,
			role: data.role,
			invitedBy: data.invitedBy ?? null,
		})
		.onConflictDoUpdate({
			target: [
				enterpriseTeamMembers.teamId,
				enterpriseTeamMembers.userId,
			],
			set: { role: data.role },
		})
		.returning();
	return rows[0] as (typeof rows)[number];
}

export async function removeTeamMember(teamId: string, userId: string) {
	await db
		.delete(enterpriseTeamMembers)
		.where(
			and(
				eq(enterpriseTeamMembers.teamId, teamId),
				eq(enterpriseTeamMembers.userId, userId),
			),
		);
}

export async function updateTeamMemberRole(
	teamId: string,
	userId: string,
	role: "admin" | "member",
) {
	const rows = await db
		.update(enterpriseTeamMembers)
		.set({ role })
		.where(
			and(
				eq(enterpriseTeamMembers.teamId, teamId),
				eq(enterpriseTeamMembers.userId, userId),
			),
		)
		.returning();
	return rows[0] ?? null;
}

// ─── Team Activity ────────────────────────────────────────────────────────────

export async function getTeamActivity(
	teamId: string,
	opts: { limit?: number; offset?: number } = {},
) {
	return db.query.enterpriseTeamActivity.findMany({
		where: (a, { eq }) => eq(a.teamId, teamId),
		orderBy: (a, { desc }) => [desc(a.createdAt)],
		limit: opts.limit ?? 50,
		offset: opts.offset ?? 0,
	});
}

export async function createTeamActivity(data: {
	teamId: string;
	actorId: string;
	action: string;
	entityType?: string;
	entityId?: string;
	details?: Record<string, unknown>;
}) {
	try {
		await db.insert(enterpriseTeamActivity).values({
			teamId: data.teamId,
			actorId: data.actorId,
			action: data.action,
			entityType: data.entityType ?? null,
			entityId: data.entityId ?? null,
			details: data.details ?? null,
		});
	} catch (err) {
		console.error("[createTeamActivity] Failed to log activity:", err);
	}
}

// ─── SSO Providers ────────────────────────────────────────────────────────────

export async function getSsoProvidersForOrg(orgId: string) {
	return db.query.enterpriseSsoProviders.findMany({
		where: (p, { eq }) => eq(p.orgId, orgId),
		orderBy: (p, { asc }) => [asc(p.createdAt)],
		limit: 50,
	});
}

export async function getSsoProviderById(providerId: string) {
	return db.query.enterpriseSsoProviders.findFirst({
		where: (p, { eq }) => eq(p.id, providerId),
	});
}

export async function getSsoProviderByDomain(domain: string) {
	return db.query.enterpriseSsoProviders.findFirst({
		where: (p, { and, eq }) =>
			and(eq(p.domain, domain), eq(p.status, "active")),
	});
}

export async function upsertSsoProvider(data: {
	orgId: string;
	type: "saml" | "oidc";
	domain: string;
	providerName?: string;
	encryptedConfig: Buffer;
	metadata?: Record<string, unknown>;
	createdBy: string;
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.enterpriseSsoProviders.findFirst({
			where: (p, { and, eq }) =>
				and(eq(p.orgId, data.orgId), eq(p.type, data.type)),
		});

		if (existing) {
			const rows = await tx
				.update(enterpriseSsoProviders)
				.set({
					domain: data.domain,
					providerName: data.providerName ?? null,
					encryptedConfig: data.encryptedConfig,
					metadata: data.metadata ?? {},
					updatedAt: new Date(),
				})
				.where(eq(enterpriseSsoProviders.id, existing.id))
				.returning();
			return rows[0] as (typeof rows)[number];
		}

		const rows = await tx
			.insert(enterpriseSsoProviders)
			.values({
				orgId: data.orgId,
				type: data.type,
				domain: data.domain,
				providerName: data.providerName ?? null,
				encryptedConfig: data.encryptedConfig,
				metadata: data.metadata ?? {},
				createdBy: data.createdBy,
			})
			.returning();
		return rows[0] as (typeof rows)[number];
	});
}

export async function updateSsoProviderStatus(
	providerId: string,
	status: "active" | "inactive" | "testing",
) {
	const rows = await db
		.update(enterpriseSsoProviders)
		.set({ status, updatedAt: new Date() })
		.where(eq(enterpriseSsoProviders.id, providerId))
		.returning();
	return rows[0] ?? null;
}

export async function deleteSsoProvider(providerId: string) {
	await db
		.delete(enterpriseSsoProviders)
		.where(eq(enterpriseSsoProviders.id, providerId));
}

// ─── SCIM Tokens ──────────────────────────────────────────────────────────────

export async function getScimTokensForOrg(orgId: string) {
	return db.query.enterpriseScimTokens.findMany({
		where: (t, { eq }) => eq(t.orgId, orgId),
		orderBy: (t, { desc }) => [desc(t.createdAt)],
		limit: 50,
	});
}

export async function createScimToken(data: {
	orgId: string;
	tokenHash: string;
	tokenSuffix: string;
	description?: string;
	expiresAt?: Date;
	createdBy: string;
}) {
	const rows = await db
		.insert(enterpriseScimTokens)
		.values({
			orgId: data.orgId,
			tokenHash: data.tokenHash,
			tokenSuffix: data.tokenSuffix,
			description: data.description ?? null,
			expiresAt: data.expiresAt ?? null,
			createdBy: data.createdBy,
		})
		.returning();
	return rows[0] as (typeof rows)[number];
}

export async function deleteScimToken(tokenId: string) {
	await db
		.delete(enterpriseScimTokens)
		.where(eq(enterpriseScimTokens.id, tokenId));
}

export async function touchScimToken(tokenId: string) {
	await db
		.update(enterpriseScimTokens)
		.set({ lastUsedAt: new Date() })
		.where(eq(enterpriseScimTokens.id, tokenId));
}

// ─── Audit Retention ──────────────────────────────────────────────────────────

export async function getAuditRetentionForOrg(orgId: string) {
	return db.query.enterpriseAuditRetention.findFirst({
		where: (r, { eq }) => eq(r.orgId, orgId),
	});
}

export async function upsertAuditRetention(data: {
	orgId: string;
	retentionDays: number;
	exportEnabled: boolean;
	exportSchedule?: string;
	exportRecipients?: string;
	updatedBy: string;
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.enterpriseAuditRetention.findFirst({
			where: eq(enterpriseAuditRetention.orgId, data.orgId),
		});

		if (existing) {
			const rows = await tx
				.update(enterpriseAuditRetention)
				.set({
					retentionDays: data.retentionDays,
					exportEnabled: data.exportEnabled,
					exportSchedule: data.exportSchedule ?? null,
					exportRecipients: data.exportRecipients ?? null,
					updatedBy: data.updatedBy,
					updatedAt: new Date(),
				})
				.where(eq(enterpriseAuditRetention.id, existing.id))
				.returning();
			return rows[0] as (typeof rows)[number];
		}

		const rows = await tx
			.insert(enterpriseAuditRetention)
			.values({
				orgId: data.orgId,
				retentionDays: data.retentionDays,
				exportEnabled: data.exportEnabled,
				exportSchedule: data.exportSchedule ?? null,
				exportRecipients: data.exportRecipients ?? null,
				updatedBy: data.updatedBy,
			})
			.returning();
		return rows[0] as (typeof rows)[number];
	});
}

// ─── Enhanced Audit Log Search ────────────────────────────────────────────────

export async function searchAuditEvents(
	orgId: string,
	opts: {
		query?: string;
		entityType?: string;
		actorId?: string;
		action?: string;
		startDate?: Date;
		endDate?: Date;
		limit?: number;
		offset?: number;
	} = {},
) {
	const conditions = [eq(auditEvents.orgId, orgId)];

	if (opts.entityType) {
		conditions.push(eq(auditEvents.entityType, opts.entityType));
	}
	if (opts.actorId) {
		conditions.push(eq(auditEvents.actorId, opts.actorId));
	}
	if (opts.action) {
		conditions.push(
			ilike(auditEvents.action, `%${escapeLikePattern(opts.action)}%`),
		);
	}
	if (opts.startDate) {
		conditions.push(gte(auditEvents.createdAt, opts.startDate));
	}
	if (opts.endDate) {
		conditions.push(lte(auditEvents.createdAt, opts.endDate));
	}

	const [items, countResult] = await Promise.all([
		db
			.select()
			.from(auditEvents)
			.where(and(...conditions))
			.orderBy(desc(auditEvents.createdAt))
			.limit(opts.limit ?? 50)
			.offset(opts.offset ?? 0),
		db
			.select({ count: sql<number>`count(*)` })
			.from(auditEvents)
			.where(and(...conditions)),
	]);

	return {
		items,
		total: Number(countResult[0]?.count ?? 0),
	};
}

export async function getAuditEventsForExport(
	orgId: string,
	opts: {
		startDate?: Date;
		endDate?: Date;
		entityType?: string;
		limit?: number;
	} = {},
) {
	const conditions = [eq(auditEvents.orgId, orgId)];

	if (opts.entityType) {
		conditions.push(eq(auditEvents.entityType, opts.entityType));
	}
	if (opts.startDate) {
		conditions.push(gte(auditEvents.createdAt, opts.startDate));
	}
	if (opts.endDate) {
		conditions.push(lte(auditEvents.createdAt, opts.endDate));
	}

	return db
		.select()
		.from(auditEvents)
		.where(and(...conditions))
		.orderBy(desc(auditEvents.createdAt))
		.limit(Math.min(opts.limit ?? 1000, 5000));
}

// ─── Billing Tiers ────────────────────────────────────────────────────────────

export async function getActiveBillingTiers() {
	return db.query.enterpriseBillingTiers.findMany({
		where: (t, { eq }) => eq(t.isActive, true),
		orderBy: (t, { asc }) => [asc(t.sortOrder)],
		limit: 50,
	});
}

export async function getBillingTierById(tierId: string) {
	return db.query.enterpriseBillingTiers.findFirst({
		where: (t, { eq }) => eq(t.id, tierId),
	});
}

export async function getOrgTier(orgId: string) {
	return db.query.enterpriseOrgTier.findFirst({
		where: (ot, { eq }) => eq(ot.orgId, orgId),
		with: {
			tier: true,
		},
	});
}

export async function upsertOrgTier(data: {
	orgId: string;
	tierId: string;
	seats: number;
	overageEnabled?: boolean;
	externalSubscriptionId?: string;
	periodEnd?: Date;
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.enterpriseOrgTier.findFirst({
			where: (ot, { eq }) => eq(ot.orgId, data.orgId),
		});

		if (existing) {
			const rows = await tx
				.update(enterpriseOrgTier)
				.set({
					tierId: data.tierId,
					seats: data.seats,
					overageEnabled:
						data.overageEnabled ?? existing.overageEnabled,
					externalSubscriptionId:
						data.externalSubscriptionId ??
						existing.externalSubscriptionId,
					periodEnd: data.periodEnd ?? existing.periodEnd,
					updatedAt: new Date(),
				})
				.where(eq(enterpriseOrgTier.id, existing.id))
				.returning();
			return rows[0] as (typeof rows)[number];
		}

		const rows = await tx
			.insert(enterpriseOrgTier)
			.values({
				orgId: data.orgId,
				tierId: data.tierId,
				seats: data.seats,
				overageEnabled: data.overageEnabled ?? false,
				externalSubscriptionId: data.externalSubscriptionId ?? null,
				periodEnd: data.periodEnd ?? null,
			})
			.returning();
		return rows[0] as (typeof rows)[number];
	});
}

export async function updateOrgSeats(orgId: string, seats: number) {
	const rows = await db
		.update(enterpriseOrgTier)
		.set({ seats, updatedAt: new Date() })
		.where(eq(enterpriseOrgTier.orgId, orgId))
		.returning();
	return rows[0] ?? null;
}

// ─── Overage Alerts ───────────────────────────────────────────────────────────

export async function getOverageAlertsForOrg(
	orgId: string,
	metric: string,
	thresholdPercent: number,
	since: Date,
) {
	return db.query.enterpriseOverageAlerts.findMany({
		where: (a, { and, eq, gte }) =>
			and(
				eq(a.orgId, orgId),
				eq(a.metric, metric),
				eq(a.thresholdPercent, thresholdPercent),
				gte(a.sentAt, since),
			),
		limit: 100,
	});
}

export async function createOverageAlert(data: {
	orgId: string;
	metric: string;
	thresholdPercent: number;
	usageValue: number;
	limitValue: number;
}) {
	const rows = await db
		.insert(enterpriseOverageAlerts)
		.values(data)
		.returning();
	return rows[0] as (typeof rows)[number];
}

// ─── Seed helpers (admin only) ────────────────────────────────────────────────

export async function seedDefaultBillingTiers() {
	const tiers = [
		{
			name: "starter",
			displayName: "Starter",
			description: "For small teams getting started.",
			pricePerSeatCents: 0,
			interval: "monthly" as const,
			features: {
				sso: false,
				scim: false,
				advancedAudit: false,
				customRoles: false,
				prioritySupport: false,
				sla: false,
				dedicatedCsm: false,
				customContracts: false,
			},
			limits: {
				seats: 5,
				domains: 10,
				contentItems: 500,
				storageGb: 10,
				aiIdeasPerMonth: 100,
				publishingJobsPerMonth: 200,
				apiCallsPerDay: 1000,
			},
			isActive: true,
			sortOrder: 0,
		},
		{
			name: "growth",
			displayName: "Growth",
			description: "For growing teams that need more power.",
			pricePerSeatCents: 4900,
			interval: "monthly" as const,
			features: {
				sso: false,
				scim: false,
				advancedAudit: true,
				customRoles: false,
				prioritySupport: false,
				sla: false,
				dedicatedCsm: false,
				customContracts: false,
			},
			limits: {
				seats: 25,
				domains: 50,
				contentItems: 5000,
				storageGb: 100,
				aiIdeasPerMonth: 1000,
				publishingJobsPerMonth: 2000,
				apiCallsPerDay: 10000,
			},
			isActive: true,
			sortOrder: 1,
		},
		{
			name: "enterprise",
			displayName: "Enterprise",
			description:
				"For large organizations requiring SSO, SCIM, and SLA guarantees.",
			pricePerSeatCents: 14900,
			interval: "monthly" as const,
			features: {
				sso: true,
				scim: true,
				advancedAudit: true,
				customRoles: true,
				prioritySupport: true,
				sla: true,
				dedicatedCsm: true,
				customContracts: true,
			},
			limits: {
				seats: -1,
				domains: -1,
				contentItems: -1,
				storageGb: -1,
				aiIdeasPerMonth: -1,
				publishingJobsPerMonth: -1,
				apiCallsPerDay: -1,
			},
			isActive: true,
			sortOrder: 2,
		},
	];

	for (const tier of tiers) {
		await db
			.insert(enterpriseBillingTiers)
			.values(tier)
			.onConflictDoUpdate({
				target: enterpriseBillingTiers.name,
				set: {
					displayName: tier.displayName,
					description: tier.description,
					pricePerSeatCents: tier.pricePerSeatCents,
					features: tier.features,
					limits: tier.limits,
					updatedAt: new Date(),
				},
			});
	}
}
