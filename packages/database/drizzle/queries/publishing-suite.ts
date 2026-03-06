/**
 * Phase 2B — Full Publishing Suite DB Queries
 * Uses only existing v9 schema tables:
 *   publish_targets, publishing_jobs, publish_attempts, webhook_events, integrations
 * No schema modifications.
 */
import {
	and,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	lte,
	sql,
} from "drizzle-orm";
import { db } from "../client";
import {
	integrations,
	publishAttempts,
	publishingJobs,
	publishTargets,
	webhookEvents,
} from "../schema";

// ─── Publish Targets (platform credentials) ───────────────────────────────────

export async function getPublishTargetsForDomain(domainId: string) {
	return db.query.publishTargets.findMany({
		where: eq(publishTargets.domainId, domainId),
		orderBy: [publishTargets.createdAt],
		limit: 50,
	});
}

export async function getPublishTargetById(id: string) {
	return db.query.publishTargets.findFirst({
		where: eq(publishTargets.id, id),
	});
}

export async function upsertPublishTarget(data: {
	domainId: string;
	target: string;
	encryptedConfig: Buffer;
	enabled?: boolean;
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.publishTargets.findFirst({
			where: and(
				eq(publishTargets.domainId, data.domainId),
				eq(
					publishTargets.target,
					data.target as (typeof publishTargets.$inferSelect)["target"],
				),
			),
		});
		if (existing) {
			return tx
				.update(publishTargets)
				.set({
					encryptedConfig: data.encryptedConfig,
					enabled: data.enabled ?? true,
				})
				.where(eq(publishTargets.id, existing.id))
				.returning();
		}
		return tx
			.insert(publishTargets)
			.values(data as typeof publishTargets.$inferInsert)
			.returning();
	});
}

export async function togglePublishTarget(id: string, enabled: boolean) {
	return db
		.update(publishTargets)
		.set({ enabled })
		.where(eq(publishTargets.id, id))
		.returning();
}

export async function deletePublishTarget(id: string) {
	return db.delete(publishTargets).where(eq(publishTargets.id, id));
}

// ─── Publishing Jobs — Bulk & Calendar ────────────────────────────────────────

export async function getPublishingJobsForOrg(
	orgId: string,
	opts: {
		limit?: number;
		offset?: number;
		status?: string;
		target?: string;
		from?: Date;
		to?: Date;
	} = {},
) {
	const conditions = [
		// join through domains to filter by org
		sql`${publishingJobs.domainId} IN (
      SELECT id FROM domains WHERE org_id = ${orgId}
    )`,
	];
	if (opts.status) {
		conditions.push(eq(publishingJobs.status, opts.status));
	}
	if (opts.target) {
		conditions.push(
			eq(
				publishingJobs.target,
				opts.target as (typeof publishingJobs.$inferSelect)["target"],
			),
		);
	}
	if (opts.from) {
		conditions.push(gte(publishingJobs.scheduledFor, opts.from));
	}
	if (opts.to) {
		conditions.push(lte(publishingJobs.scheduledFor, opts.to));
	}

	return db.query.publishingJobs.findMany({
		where: and(...conditions),
		orderBy: [desc(publishingJobs.scheduledFor)],
		limit: opts.limit ?? 100,
		offset: opts.offset ?? 0,
	});
}

export async function bulkCreatePublishingJobs(
	jobs: Array<{
		domainId: string;
		contentId?: string;
		target: string;
		scheduledFor?: Date;
	}>,
) {
	if (jobs.length === 0) {
		return [];
	}
	return db
		.insert(publishingJobs)
		.values(jobs as (typeof publishingJobs.$inferInsert)[])
		.returning();
}

export async function updatePublishingJobStatus(
	id: string,
	status: string,
	opts: { error?: string; executedAt?: Date } = {},
) {
	return db
		.update(publishingJobs)
		.set({ status, error: opts.error, executedAt: opts.executedAt })
		.where(eq(publishingJobs.id, id))
		.returning();
}

export async function cancelPublishingJob(id: string) {
	return db
		.update(publishingJobs)
		.set({ status: "cancelled" })
		.where(eq(publishingJobs.id, id))
		.returning();
}

export async function getScheduledJobsInRange(
	domainId: string,
	from: Date,
	to: Date,
) {
	return db.query.publishingJobs.findMany({
		where: and(
			eq(publishingJobs.domainId, domainId),
			gte(publishingJobs.scheduledFor, from),
			lte(publishingJobs.scheduledFor, to),
		),
		orderBy: [publishingJobs.scheduledFor],
		limit: 500,
	});
}

// ─── Publish Attempts — Retry & DLQ ──────────────────────────────────────────

export async function getPublishAttemptsForJobFull(jobId: string) {
	return db.query.publishAttempts.findMany({
		where: eq(publishAttempts.jobId, jobId),
		orderBy: [desc(publishAttempts.attemptedAt)],
		limit: 50,
	});
}

export async function countAttemptsForJob(jobId: string): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(publishAttempts)
		.where(eq(publishAttempts.jobId, jobId));
	return row?.n ?? 0;
}

export async function recordPublishAttempt(data: {
	jobId: string;
	status: string;
	response?: Record<string, unknown>;
}) {
	return db
		.insert(publishAttempts)
		.values(data as typeof publishAttempts.$inferInsert)
		.returning();
}

export async function getFailedJobsForDLQ(
	orgId: string,
	opts: { limit?: number; offset?: number } = {},
) {
	return db.query.publishingJobs.findMany({
		where: and(
			sql`${publishingJobs.domainId} IN (
        SELECT id FROM domains WHERE org_id = ${orgId}
      )`,
			eq(publishingJobs.status, "failed"),
		),
		orderBy: [desc(publishingJobs.createdAt)],
		limit: opts.limit ?? 50,
		offset: opts.offset ?? 0,
	});
}

export async function retryPublishingJob(id: string) {
	return db
		.update(publishingJobs)
		.set({ status: "pending", error: null, executedAt: null })
		.where(eq(publishingJobs.id, id))
		.returning();
}

export async function retryPublishingJobForOrg(id: string, orgId: string) {
	return db
		.update(publishingJobs)
		.set({ status: "pending", error: null, executedAt: null })
		.where(
			and(
				eq(publishingJobs.id, id),
				sql`${publishingJobs.domainId} IN (SELECT id FROM domains WHERE org_id = ${orgId})`,
			),
		)
		.returning();
}

export async function bulkRetryJobs(ids: string[]) {
	if (ids.length === 0) {
		return [];
	}
	return db
		.update(publishingJobs)
		.set({ status: "pending", error: null, executedAt: null })
		.where(inArray(publishingJobs.id, ids))
		.returning();
}

export async function bulkRetryJobsForOrg(ids: string[], orgId: string) {
	if (ids.length === 0) {
		return [];
	}
	return db
		.update(publishingJobs)
		.set({ status: "pending", error: null, executedAt: null })
		.where(
			and(
				inArray(publishingJobs.id, ids),
				sql`${publishingJobs.domainId} IN (SELECT id FROM domains WHERE org_id = ${orgId})`,
			),
		)
		.returning();
}

// ─── Webhook Events (DLQ outbox) ──────────────────────────────────────────────

export async function getPendingWebhookEvents(opts: { limit?: number } = {}) {
	return db.query.webhookEvents.findMany({
		where: eq(webhookEvents.outboxStatus, "pending"),
		orderBy: [webhookEvents.createdAt],
		limit: opts.limit ?? 50,
	});
}

export async function getFailedWebhookEvents(
	opts: { limit?: number; offset?: number } = {},
) {
	return db.query.webhookEvents.findMany({
		where: eq(webhookEvents.outboxStatus, "failed"),
		orderBy: [desc(webhookEvents.createdAt)],
		limit: opts.limit ?? 50,
		offset: opts.offset ?? 0,
	});
}

export async function markWebhookEventProcessed(id: string) {
	return db
		.update(webhookEvents)
		.set({ processed: true, outboxStatus: "processed" })
		.where(eq(webhookEvents.id, id));
}

export async function markWebhookEventFailed(id: string, error: string) {
	return db
		.update(webhookEvents)
		.set({ outboxStatus: "failed", error })
		.where(eq(webhookEvents.id, id));
}

export async function incrementWebhookReplayCount(id: string) {
	return db
		.update(webhookEvents)
		.set({
			replayCount: sql`${webhookEvents.replayCount} + 1`,
			outboxStatus: "pending",
		})
		.where(eq(webhookEvents.id, id));
}

export async function createWebhookEvent(data: {
	provider: string;
	eventType: string;
	payload?: Record<string, unknown>;
}) {
	return db
		.insert(webhookEvents)
		.values(data as typeof webhookEvents.$inferInsert)
		.returning();
}

// ─── Integrations (encrypted platform credentials) ────────────────────────────

export async function getIntegrationsForOrg(orgId: string) {
	return db.query.integrations.findMany({
		where: eq(integrations.orgId, orgId),
		orderBy: [integrations.createdAt],
		limit: 100,
	});
}

export async function getIntegrationsForDomain(domainId: string) {
	return db.query.integrations.findMany({
		where: eq(integrations.domainId, domainId),
		limit: 50,
	});
}

export async function upsertIntegration(data: {
	orgId: string;
	domainId?: string;
	provider: string;
	encryptedConfig: Buffer;
	enabled?: boolean;
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.integrations.findFirst({
			where: and(
				eq(integrations.orgId, data.orgId),
				eq(integrations.provider, data.provider),
				data.domainId
					? eq(integrations.domainId, data.domainId)
					: isNull(integrations.domainId),
			),
		});
		if (existing) {
			return tx
				.update(integrations)
				.set({
					encryptedConfig: data.encryptedConfig,
					enabled: data.enabled ?? true,
				})
				.where(eq(integrations.id, existing.id))
				.returning();
		}
		return tx
			.insert(integrations)
			.values(data as typeof integrations.$inferInsert)
			.returning();
	});
}

export async function toggleIntegration(id: string, enabled: boolean) {
	return db
		.update(integrations)
		.set({ enabled })
		.where(eq(integrations.id, id))
		.returning();
}

// ─── Analytics — post-publish performance (stored in job response jsonb) ──────

export async function getPublishAnalyticsForDomain(domainId: string) {
	// Aggregate response jsonb from publish_attempts for analytics
	const rows = await db
		.select({
			jobId: publishAttempts.jobId,
			status: publishAttempts.status,
			response: publishAttempts.response,
			attemptedAt: publishAttempts.attemptedAt,
			target: publishingJobs.target,
			contentId: publishingJobs.contentId,
		})
		.from(publishAttempts)
		.innerJoin(publishingJobs, eq(publishAttempts.jobId, publishingJobs.id))
		.where(
			and(
				eq(publishingJobs.domainId, domainId),
				eq(publishAttempts.status, "success"),
			),
		)
		.orderBy(desc(publishAttempts.attemptedAt))
		.limit(500);

	return rows.map((r) => {
		const resp = (r.response ?? {}) as Record<string, unknown>;
		return {
			jobId: r.jobId,
			target: r.target,
			contentId: r.contentId,
			attemptedAt: r.attemptedAt,
			views: (resp.views as number) ?? 0,
			engagement: (resp.engagement as number) ?? 0,
			clicks: (resp.clicks as number) ?? 0,
			impressions: (resp.impressions as number) ?? 0,
			platformPostId: (resp.platformPostId as string) ?? null,
		};
	});
}

export async function getPublishingJobStatusSummary(domainId: string) {
	const rows = await db
		.select({
			status: publishingJobs.status,
			n: count(),
		})
		.from(publishingJobs)
		.where(eq(publishingJobs.domainId, domainId))
		.groupBy(publishingJobs.status);

	const summary: Record<string, number> = {};
	for (const r of rows) {
		summary[r.status] = r.n;
	}
	return summary;
}

export async function getPublishingJobStatusSummaryForOrg(orgId: string) {
	const rows = await db
		.select({
			status: publishingJobs.status,
			target: publishingJobs.target,
			n: count(),
		})
		.from(publishingJobs)
		.where(
			sql`${publishingJobs.domainId} IN (
        SELECT id FROM domains WHERE org_id = ${orgId}
      )`,
		)
		.groupBy(publishingJobs.status, publishingJobs.target);

	return rows;
}
