/**
 * SmartBeak v9 — Database Query Functions
 * All queries use the locked v9 schema from smartbeak.ts.
 * Do NOT modify table/column names here — they must match the schema exactly.
 */
import { and, count, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "../client";

function escapeLikePattern(pattern: string): string {
	return pattern.replace(/[%_\\]/g, "\\$&");
}

import {
	auditEvents,
	buyerSessions,
	contentItems,
	contentRevisions,
	diligenceChecks,
	domains,
	featureFlags,
	guardrails,
	integrations,
	invoices,
	keywordTracking,
	mediaAssets,
	monetizationDecaySignals,
	onboardingProgress,
	organizationMembers,
	organizations,
	portfolioSummaries,
	publishAttempts,
	publishingJobs,
	publishTargets,
	seoDocuments,
	siteShards,
	subscriptions,
	timelineEvents,
	usageRecords,
	webhookEvents,
} from "../schema/smartbeak";

// ─── Organizations ────────────────────────────────────────────────────────────

export async function getSmartBeakOrgBySlug(slug: string) {
	return db.query.organizations.findFirst({
		where: (o, { eq }) => eq(o.slug, slug),
	});
}

export async function getSmartBeakOrgById(id: string) {
	return db.query.organizations.findFirst({
		where: (o, { eq }) => eq(o.id, id),
	});
}

export async function upsertSmartBeakOrg(data: {
	id: string;
	name: string;
	slug: string;
	settings?: Record<string, unknown>;
}) {
	return db
		.insert(organizations)
		.values(data)
		.onConflictDoUpdate({
			target: organizations.slug,
			set: {
				name: data.name,
				...(data.settings !== undefined && { settings: data.settings }),
			},
		})
		.returning();
}

// ─── Organization Members ─────────────────────────────────────────────────────

export async function getSmartBeakOrgMembers(orgId: string) {
	return db.query.organizationMembers.findMany({
		where: (m, { eq }) => eq(m.orgId, orgId),
		limit: 200,
	});
}

export async function getSmartBeakOrgMember(orgId: string, userId: string) {
	return db.query.organizationMembers.findFirst({
		where: (m, { and, eq }) =>
			and(eq(m.orgId, orgId), eq(m.userId, userId)),
	});
}

export async function upsertSmartBeakOrgMember(data: {
	orgId: string;
	userId: string;
	role: "owner" | "admin" | "editor" | "viewer";
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.organizationMembers.findFirst({
			where: (m, { and: a, eq: e }) =>
				a(e(m.orgId, data.orgId), e(m.userId, data.userId)),
		});
		if (existing) {
			return tx
				.update(organizationMembers)
				.set({ role: data.role })
				.where(eq(organizationMembers.id, existing.id))
				.returning();
		}
		return tx.insert(organizationMembers).values(data).returning();
	});
}

// ─── Domains ──────────────────────────────────────────────────────────────────

export async function getDomainsForOrg(
	orgId: string,
	opts?: { query?: string; limit?: number; offset?: number },
) {
	return db.query.domains.findMany({
		where: (d, { eq, and, ilike }) =>
			opts?.query
				? and(
						eq(d.orgId, orgId),
						ilike(d.name, `%${escapeLikePattern(opts.query)}%`),
					)
				: eq(d.orgId, orgId),
		limit: opts?.limit ?? 50,
		offset: opts?.offset ?? 0,
		orderBy: (d, { desc }) => [desc(d.createdAt)],
	});
}

export async function countDomainsForOrg(
	orgId: string,
	opts?: { query?: string },
) {
	const conditions = [eq(domains.orgId, orgId)];
	if (opts?.query) {
		conditions.push(
			ilike(domains.name, `%${escapeLikePattern(opts.query)}%`),
		);
	}
	const result = await db
		.select({ count: sql<number>`count(*)` })
		.from(domains)
		.where(and(...conditions));
	return Number(result[0]?.count ?? 0);
}

export async function getDomainById(id: string) {
	return db.query.domains.findFirst({
		where: (d, { eq }) => eq(d.id, id),
	});
}

export async function createDomain(data: {
	orgId: string;
	name: string;
	slug: string;
	themeId?: string;
}) {
	return db.insert(domains).values(data).returning();
}

export async function updateDomain(
	id: string,
	data: Partial<{
		name: string;
		status: "active" | "pending" | "suspended" | "deployed" | "error";
		themeId: string;
		deployedUrl: string | null;
		registryData: Record<string, unknown> | null;
		health: Record<string, unknown> | null;
		lifecycle: Record<string, unknown> | null;
	}>,
	expectedStatus?: string,
) {
	const conditions = [eq(domains.id, id)];
	if (expectedStatus) {
		conditions.push(eq(domains.status, expectedStatus));
	}
	return db
		.update(domains)
		.set({ ...data, updatedAt: new Date() })
		.where(and(...conditions))
		.returning();
}

export async function deleteDomain(id: string) {
	return db.delete(domains).where(eq(domains.id, id));
}

// ─── Content Items ────────────────────────────────────────────────────────────

export async function getContentItemsForDomain(
	domainId: string,
	opts?: {
		status?: "draft" | "published" | "scheduled" | "archived";
		limit?: number;
		offset?: number;
		query?: string;
	},
) {
	return db.query.contentItems.findMany({
		where: (c, { eq, and, ilike, isNull }) => {
			const conditions = [eq(c.domainId, domainId), isNull(c.deletedAt)];
			if (opts?.status) {
				conditions.push(eq(c.status, opts.status));
			}
			if (opts?.query) {
				conditions.push(
					ilike(c.title, `%${escapeLikePattern(opts.query)}%`),
				);
			}
			return and(...conditions);
		},
		limit: opts?.limit ?? 50,
		offset: opts?.offset ?? 0,
		orderBy: (c, { desc }) => [desc(c.updatedAt)],
	});
}

export async function countContentItemsForDomain(
	domainId: string,
	opts?: {
		status?: "draft" | "published" | "scheduled" | "archived";
		query?: string;
	},
) {
	const conditions = [
		eq(contentItems.domainId, domainId),
		sql`${contentItems.deletedAt} IS NULL`,
	];
	if (opts?.status) {
		conditions.push(eq(contentItems.status, opts.status));
	}
	if (opts?.query) {
		conditions.push(
			ilike(contentItems.title, `%${escapeLikePattern(opts.query)}%`),
		);
	}
	const result = await db
		.select({ count: sql<number>`count(*)` })
		.from(contentItems)
		.where(and(...conditions));
	return Number(result[0]?.count ?? 0);
}

export async function getContentItemById(id: string) {
	return db.query.contentItems.findFirst({
		where: (c, { eq, and, isNull }) =>
			and(eq(c.id, id), isNull(c.deletedAt)),
	});
}

export async function createContentItem(data: {
	domainId: string;
	title: string;
	body?: string;
	status?: "draft" | "published" | "scheduled" | "archived";
	scheduledFor?: Date;
	createdBy?: string;
}) {
	return db.insert(contentItems).values(data).returning();
}

export async function updateContentItem(
	id: string,
	data: Partial<{
		title: string;
		body: string | null;
		status: "draft" | "published" | "scheduled" | "archived";
		revisions: unknown[];
		publishedAt: Date | null;
		scheduledFor: Date | null;
		version: number;
		updatedBy: string;
	}>,
	expectedVersion?: number,
) {
	const conditions = [eq(contentItems.id, id)];
	if (expectedVersion !== undefined) {
		conditions.push(eq(contentItems.version, expectedVersion));
	}
	return db
		.update(contentItems)
		.set({ ...data, updatedAt: new Date() })
		.where(and(...conditions))
		.returning();
}

export async function softDeleteContentItem(id: string) {
	return db
		.update(contentItems)
		.set({ deletedAt: new Date() })
		.where(eq(contentItems.id, id))
		.returning();
}

// ─── Content Revisions ────────────────────────────────────────────────────────

export async function getContentRevisions(contentId: string) {
	return db.query.contentRevisions.findMany({
		where: (r, { eq }) => eq(r.contentId, contentId),
		orderBy: (r, { desc }) => [desc(r.version)],
		limit: 100,
	});
}

export async function createContentRevision(data: {
	contentId: string;
	version: number;
	body?: string;
	changedBy?: string;
}) {
	return db.insert(contentRevisions).values(data).returning();
}

// ─── Media Assets ─────────────────────────────────────────────────────────────

export async function getMediaAssetsForDomain(
	domainId: string,
	opts?: { limit?: number; offset?: number; type?: string },
) {
	return db.query.mediaAssets.findMany({
		where: (m, { eq, and }) =>
			opts?.type
				? and(eq(m.domainId, domainId), eq(m.type, opts.type))
				: eq(m.domainId, domainId),
		limit: opts?.limit ?? 50,
		offset: opts?.offset ?? 0,
		orderBy: (m, { desc }) => [desc(m.createdAt)],
	});
}

export async function countMediaAssetsForDomain(
	domainId: string,
	opts?: { type?: string },
) {
	const conditions = [eq(mediaAssets.domainId, domainId)];
	if (opts?.type) {
		conditions.push(eq(mediaAssets.type, opts.type));
	}
	const result = await db
		.select({ count: sql<number>`count(*)` })
		.from(mediaAssets)
		.where(and(...conditions));
	return Number(result[0]?.count ?? 0);
}

export async function getMediaAssetById(id: string) {
	return db.query.mediaAssets.findFirst({
		where: (m, { eq }) => eq(m.id, id),
	});
}

export async function createMediaAsset(data: {
	domainId: string;
	fileName: string;
	url: string;
	type: string;
	size?: number;
	metadata?: Record<string, unknown>;
}) {
	return db.insert(mediaAssets).values(data).returning();
}

export async function updateMediaAsset(
	id: string,
	data: Partial<{
		lifecycle: Record<string, unknown> | null;
		metadata: Record<string, unknown> | null;
	}>,
) {
	return db
		.update(mediaAssets)
		.set(data)
		.where(eq(mediaAssets.id, id))
		.returning();
}

export async function deleteMediaAsset(id: string) {
	return db.delete(mediaAssets).where(eq(mediaAssets.id, id));
}

// ─── Publish Targets ──────────────────────────────────────────────────────────

export async function getPublishTargetsForDomain(domainId: string) {
	return db.query.publishTargets.findMany({
		where: (t, { eq }) => eq(t.domainId, domainId),
		limit: 50,
	});
}

export async function createPublishTarget(data: {
	domainId: string;
	target:
		| "web"
		| "linkedin"
		| "facebook"
		| "instagram"
		| "youtube"
		| "wordpress"
		| "email"
		| "tiktok"
		| "pinterest"
		| "vimeo"
		| "soundcloud";
	encryptedConfig: Buffer;
	enabled?: boolean;
}) {
	return db.insert(publishTargets).values(data).returning();
}

export async function updatePublishTarget(
	id: string,
	data: Partial<{ enabled: boolean; encryptedConfig: Buffer }>,
) {
	return db
		.update(publishTargets)
		.set(data)
		.where(eq(publishTargets.id, id))
		.returning();
}

export async function deletePublishTarget(id: string) {
	return db.delete(publishTargets).where(eq(publishTargets.id, id));
}

// ─── Publishing Jobs ──────────────────────────────────────────────────────────

export async function getPublishingJobsForDomain(
	domainId: string,
	opts?: { limit?: number; offset?: number },
) {
	return db.query.publishingJobs.findMany({
		where: (j, { eq }) => eq(j.domainId, domainId),
		limit: opts?.limit ?? 50,
		offset: opts?.offset ?? 0,
		orderBy: (j, { desc }) => [desc(j.createdAt)],
	});
}

export async function countPublishingJobsForDomain(domainId: string) {
	const result = await db
		.select({ count: sql<number>`count(*)` })
		.from(publishingJobs)
		.where(eq(publishingJobs.domainId, domainId));
	return Number(result[0]?.count ?? 0);
}

export async function getPublishingJobById(id: string) {
	return db.query.publishingJobs.findFirst({
		where: (j, { eq }) => eq(j.id, id),
	});
}

export async function createPublishingJob(data: {
	contentId?: string;
	domainId: string;
	target:
		| "web"
		| "linkedin"
		| "facebook"
		| "instagram"
		| "youtube"
		| "wordpress"
		| "email"
		| "tiktok"
		| "pinterest"
		| "vimeo"
		| "soundcloud";
	scheduledFor?: Date;
}) {
	return db.insert(publishingJobs).values(data).returning();
}

export async function updatePublishingJob(
	id: string,
	data: Partial<{
		status: string;
		executedAt: Date | null;
		error: string | null;
	}>,
) {
	return db
		.update(publishingJobs)
		.set(data)
		.where(eq(publishingJobs.id, id))
		.returning();
}

export async function createPublishAttempt(data: {
	jobId: string;
	status: string;
	response?: Record<string, unknown>;
}) {
	return db.insert(publishAttempts).values(data).returning();
}

export async function getPublishAttemptsForJob(jobId: string) {
	return db.query.publishAttempts.findMany({
		where: (a, { eq }) => eq(a.jobId, jobId),
		orderBy: (a, { desc }) => [desc(a.attemptedAt)],
		limit: 50,
	});
}

export async function countAttemptsByJobIds(
	jobIds: string[],
): Promise<Map<string, number>> {
	if (jobIds.length === 0) {
		return new Map();
	}
	const rows = await db
		.select({ jobId: publishAttempts.jobId, n: count() })
		.from(publishAttempts)
		.where(inArray(publishAttempts.jobId, jobIds))
		.groupBy(publishAttempts.jobId);
	return new Map(rows.map((r) => [r.jobId, r.n]));
}

// ─── SEO Documents ────────────────────────────────────────────────────────────

export async function getSeoDocumentForDomain(domainId: string) {
	return db.query.seoDocuments.findFirst({
		where: (s, { eq }) => eq(s.domainId, domainId),
	});
}

export async function upsertSeoDocument(data: {
	domainId: string;
	keywords?: unknown[];
	gscData?: Record<string, unknown> | null;
	ahrefsData?: Record<string, unknown> | null;
	decaySignals?: Record<string, unknown> | null;
	score?: number;
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.seoDocuments.findFirst({
			where: (s, { eq: e }) => e(s.domainId, data.domainId),
		});
		if (existing) {
			return tx
				.update(seoDocuments)
				.set({
					keywords: data.keywords ?? [],
					gscData: data.gscData,
					ahrefsData: data.ahrefsData,
					decaySignals: data.decaySignals,
					score: data.score ?? 0,
					updatedAt: new Date(),
				})
				.where(eq(seoDocuments.id, existing.id))
				.returning();
		}
		return tx.insert(seoDocuments).values(data).returning();
	});
}

// ─── Keyword Tracking ─────────────────────────────────────────────────────────

export async function getKeywordsForDomain(domainId: string) {
	return db.query.keywordTracking.findMany({
		where: (k, { eq }) => eq(k.domainId, domainId),
		orderBy: (k, { desc }) => [desc(k.lastUpdated)],
		limit: 500,
	});
}

export async function getKeywordById(id: string) {
	return db.query.keywordTracking.findFirst({
		where: (k, { eq }) => eq(k.id, id),
	});
}

export async function upsertKeyword(data: {
	domainId: string;
	keyword: string;
	volume?: number;
	difficulty?: number;
	position?: number;
	decayFactor?: string;
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.keywordTracking.findFirst({
			where: (k, { and: a, eq: e }) =>
				a(e(k.domainId, data.domainId), e(k.keyword, data.keyword)),
		});
		if (existing) {
			return tx
				.update(keywordTracking)
				.set({
					volume: data.volume,
					difficulty: data.difficulty,
					position: data.position,
					decayFactor: data.decayFactor,
					lastUpdated: new Date(),
				})
				.where(eq(keywordTracking.id, existing.id))
				.returning();
		}
		return tx.insert(keywordTracking).values(data).returning();
	});
}

export async function deleteKeyword(id: string) {
	return db.delete(keywordTracking).where(eq(keywordTracking.id, id));
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

export async function getSubscriptionForOrg(orgId: string) {
	return db.query.subscriptions.findFirst({
		where: (s, { eq }) => eq(s.orgId, orgId),
	});
}

export async function upsertSubscription(data: {
	orgId: string;
	stripeSubscriptionId?: string;
	status?: string;
	plan: string;
	currentPeriodEnd?: Date;
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.subscriptions.findFirst({
			where: (s, { eq: e }) => e(s.orgId, data.orgId),
		});
		if (existing) {
			return tx
				.update(subscriptions)
				.set({
					stripeSubscriptionId:
						data.stripeSubscriptionId ??
						existing.stripeSubscriptionId,
					status: data.status ?? "active",
					plan: data.plan,
					currentPeriodEnd: data.currentPeriodEnd,
				})
				.where(eq(subscriptions.id, existing.id))
				.returning();
		}
		return tx.insert(subscriptions).values(data).returning();
	});
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export async function getInvoicesForOrg(
	orgId: string,
	opts?: { limit?: number; offset?: number },
) {
	return db.query.invoices.findMany({
		where: (i, { eq }) => eq(i.orgId, orgId),
		limit: opts?.limit ?? 50,
		offset: opts?.offset ?? 0,
		orderBy: (i, { desc }) => [desc(i.createdAt)],
	});
}

export async function createInvoice(data: {
	orgId: string;
	stripeInvoiceId?: string;
	amountCents: number;
	status?: string;
	pdfUrl?: string;
}) {
	return db.insert(invoices).values(data).returning();
}

// ─── Usage Records ────────────────────────────────────────────────────────────

export async function getUsageRecordsForOrg(
	orgId: string,
	opts?: { metric?: string; limit?: number },
) {
	return db.query.usageRecords.findMany({
		where: (u, { eq, and }) =>
			opts?.metric
				? and(eq(u.orgId, orgId), eq(u.metric, opts.metric))
				: eq(u.orgId, orgId),
		limit: opts?.limit ?? 100,
		orderBy: (u, { desc }) => [desc(u.recordedAt)],
	});
}

export async function createUsageRecord(data: {
	orgId: string;
	metric: string;
	value: number;
}) {
	return db.insert(usageRecords).values(data).returning();
}

// ─── Monetization Decay Signals ───────────────────────────────────────────────

export async function getDecaySignalsForDomain(domainId: string) {
	return db.query.monetizationDecaySignals.findMany({
		where: (d, { eq }) => eq(d.domainId, domainId),
		orderBy: (d, { desc }) => [desc(d.recordedAt)],
		limit: 30,
	});
}

export async function createDecaySignal(data: {
	domainId: string;
	decayFactor: string;
	signalType: string;
}) {
	return db.insert(monetizationDecaySignals).values(data).returning();
}

// ─── Site Shards ──────────────────────────────────────────────────────────────

export async function getSiteShardsForDomain(domainId: string) {
	return db.query.siteShards.findMany({
		where: (s, { eq }) => eq(s.domainId, domainId),
		orderBy: (s, { desc }) => [desc(s.version)],
		limit: 100,
	});
}

export async function createSiteShard(data: {
	domainId: string;
	version: number;
	deployedUrl?: string;
	status?: string;
}) {
	return db.insert(siteShards).values(data).returning();
}

export async function updateSiteShard(
	id: string,
	data: Partial<{ deployedUrl: string; status: string }>,
) {
	return db
		.update(siteShards)
		.set(data)
		.where(eq(siteShards.id, id))
		.returning();
}

// ─── Diligence Checks ─────────────────────────────────────────────────────────

export async function getDiligenceChecksForDomain(domainId: string) {
	return db.query.diligenceChecks.findMany({
		where: (d, { eq }) => eq(d.domainId, domainId),
		orderBy: (d, { desc }) => [desc(d.completedAt)],
		limit: 100,
	});
}

export async function createDiligenceCheck(data: {
	domainId: string;
	type: string;
	result?: Record<string, unknown>;
	status?: string;
}) {
	return db.insert(diligenceChecks).values(data).returning();
}

export async function updateDiligenceCheck(
	id: string,
	data: Partial<{
		result: Record<string, unknown>;
		status: string;
		completedAt: Date;
	}>,
) {
	return db
		.update(diligenceChecks)
		.set(data)
		.where(eq(diligenceChecks.id, id))
		.returning();
}

// ─── Portfolio Summaries ──────────────────────────────────────────────────────

export async function getPortfolioSummaryForOrg(orgId: string) {
	return db.query.portfolioSummaries.findFirst({
		where: (p, { eq }) => eq(p.orgId, orgId),
	});
}

export async function upsertPortfolioSummary(data: {
	orgId: string;
	totalDomains?: number;
	totalValue?: string;
	avgRoi?: string;
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.portfolioSummaries.findFirst({
			where: (p, { eq: e }) => e(p.orgId, data.orgId),
		});
		if (existing) {
			return tx
				.update(portfolioSummaries)
				.set({
					totalDomains: data.totalDomains ?? 0,
					totalValue: data.totalValue,
					avgRoi: data.avgRoi,
					lastUpdated: new Date(),
				})
				.where(eq(portfolioSummaries.id, existing.id))
				.returning();
		}
		return tx.insert(portfolioSummaries).values(data).returning();
	});
}

// ─── Audit Events ─────────────────────────────────────────────────────────────

export async function getAuditEventsForOrg(
	orgId: string,
	opts?: { limit?: number; offset?: number; entityType?: string },
) {
	return db.query.auditEvents.findMany({
		where: (a, { eq, and }) =>
			opts?.entityType
				? and(eq(a.orgId, orgId), eq(a.entityType, opts.entityType))
				: eq(a.orgId, orgId),
		limit: opts?.limit ?? 50,
		offset: opts?.offset ?? 0,
		orderBy: (a, { desc }) => [desc(a.createdAt)],
	});
}

export async function countAuditEventsForOrg(
	orgId: string,
	opts?: { entityType?: string },
) {
	const conditions = [eq(auditEvents.orgId, orgId)];
	if (opts?.entityType) {
		conditions.push(eq(auditEvents.entityType, opts.entityType));
	}
	const result = await db
		.select({ count: sql<number>`count(*)` })
		.from(auditEvents)
		.where(and(...conditions));
	return Number(result[0]?.count ?? 0);
}

export async function createAuditEvent(data: {
	orgId: string;
	actorId?: string;
	action: string;
	entityType: string;
	entityId?: string;
	details?: Record<string, unknown>;
}) {
	return db.insert(auditEvents).values(data).returning();
}

// ─── Webhook Events ───────────────────────────────────────────────────────────

export async function getPendingWebhookEvents() {
	return db.query.webhookEvents.findMany({
		where: (w, { eq }) => eq(w.processed, false),
		orderBy: (w, { asc }) => [asc(w.createdAt)],
		limit: 100,
	});
}

export async function createWebhookEvent(data: {
	provider: string;
	eventType: string;
	payload?: Record<string, unknown>;
}) {
	return db.insert(webhookEvents).values(data).returning();
}

export async function markWebhookEventProcessed(id: string) {
	return db
		.update(webhookEvents)
		.set({ processed: true, outboxStatus: "processed" })
		.where(eq(webhookEvents.id, id));
}

// ─── Integrations ─────────────────────────────────────────────────────────────

export async function getIntegrationsForOrg(orgId: string) {
	return db.query.integrations.findMany({
		where: (i, { eq }) => eq(i.orgId, orgId),
		limit: 100,
	});
}

export async function createIntegration(data: {
	orgId: string;
	domainId?: string;
	provider: string;
	encryptedConfig: Buffer;
	enabled?: boolean;
}) {
	return db.insert(integrations).values(data).returning();
}

export async function updateIntegration(
	id: string,
	data: Partial<{ enabled: boolean; encryptedConfig: Buffer }>,
) {
	return db
		.update(integrations)
		.set(data)
		.where(eq(integrations.id, id))
		.returning();
}

export async function getIntegrationByProvider(
	orgId: string,
	provider: string,
) {
	return db.query.integrations.findFirst({
		where: (i, { eq, and }) =>
			and(eq(i.orgId, orgId), eq(i.provider, provider)),
	});
}

export async function deleteIntegration(id: string) {
	return db.delete(integrations).where(eq(integrations.id, id)).returning();
}

// ─── Buyer Sessions ───────────────────────────────────────────────────────────

export async function getBuyerSessionsForDomain(domainId: string) {
	return db.query.buyerSessions.findMany({
		where: (b, { eq }) => eq(b.domainId, domainId),
		orderBy: (b, { desc }) => [desc(b.createdAt)],
		limit: 100,
	});
}

export async function createBuyerSession(data: {
	domainId: string;
	sessionId: string;
	buyerEmail?: string;
	intent?: string;
}) {
	return db.insert(buyerSessions).values(data).returning();
}

// ─── Timeline Events ──────────────────────────────────────────────────────────

export async function getTimelineEventsForDomain(domainId: string) {
	return db.query.timelineEvents.findMany({
		where: (t, { eq }) => eq(t.domainId, domainId),
		orderBy: (t, { desc }) => [desc(t.createdAt)],
		limit: 100,
	});
}

export async function createTimelineEvent(data: {
	domainId: string;
	eventType: string;
	details?: Record<string, unknown>;
}) {
	return db.insert(timelineEvents).values(data).returning();
}

// ─── Guardrails ───────────────────────────────────────────────────────────────

export async function getGuardrailsForOrg(orgId: string) {
	return db.query.guardrails.findMany({
		where: (g, { eq }) => eq(g.orgId, orgId),
		limit: 100,
	});
}

export async function upsertGuardrail(data: {
	orgId: string;
	rule: string;
	value: number;
	enabled?: boolean;
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.guardrails.findFirst({
			where: (g, { and: a, eq: e }) =>
				a(e(g.orgId, data.orgId), e(g.rule, data.rule)),
		});
		if (existing) {
			return tx
				.update(guardrails)
				.set({ value: data.value, enabled: data.enabled ?? true })
				.where(eq(guardrails.id, existing.id))
				.returning();
		}
		return tx.insert(guardrails).values(data).returning();
	});
}

// ─── Feature Flags ────────────────────────────────────────────────────────────

export async function getFeatureFlagsForOrg(orgId: string) {
	return db.query.featureFlags.findMany({
		where: (f, { eq }) => eq(f.orgId, orgId),
		limit: 200,
	});
}

export async function getFeatureFlag(orgId: string, key: string) {
	return db.query.featureFlags.findFirst({
		where: (f, { and, eq }) => and(eq(f.orgId, orgId), eq(f.key, key)),
	});
}

export async function upsertFeatureFlag(data: {
	orgId: string;
	key: string;
	enabled?: boolean;
	config?: Record<string, unknown>;
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.featureFlags.findFirst({
			where: (f, { and: a, eq: e }) =>
				a(e(f.orgId, data.orgId), e(f.key, data.key)),
		});
		if (existing) {
			return tx
				.update(featureFlags)
				.set({ enabled: data.enabled ?? false, config: data.config })
				.where(eq(featureFlags.id, existing.id))
				.returning();
		}
		return tx.insert(featureFlags).values(data).returning();
	});
}

// ─── Onboarding Progress ──────────────────────────────────────────────────────

export async function getOnboardingProgressForOrg(orgId: string) {
	return db.query.onboardingProgress.findMany({
		where: (o, { eq }) => eq(o.orgId, orgId),
		limit: 100,
	});
}

export async function upsertOnboardingStep(data: {
	orgId: string;
	step: string;
	completed?: boolean;
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.onboardingProgress.findFirst({
			where: (o, { and: a, eq: e }) =>
				a(e(o.orgId, data.orgId), e(o.step, data.step)),
		});
		if (existing) {
			return tx
				.update(onboardingProgress)
				.set({
					completed: data.completed ?? false,
					completedAt: data.completed ? new Date() : null,
				})
				.where(eq(onboardingProgress.id, existing.id))
				.returning();
		}
		return tx.insert(onboardingProgress).values(data).returning();
	});
}
