// Prisma-based queries (Supastarter base)
export * from "./prisma";

// Drizzle-based queries and schemas (SmartBeak v9)
export * from "./drizzle/queries/smartbeak";
export * from "./drizzle/zod-smartbeak";
export * from "./drizzle/schema/smartbeak";

// SEO Intelligence queries and schemas (Phase 2A)
export {
	getKeywordsByDomain,
	updateKeywordMetrics,
	bulkUpsertKeywords,
	getStaleKeywords,
	recalculateDecayFactor,
	updateSeoGscData,
	updateSeoAhrefsData,
	updateSeoScore,
	getSeoDashboardSummary,
	getKeywordClusters,
	getOrgSeoOverview,
	SEO_DASHBOARD_MATERIALIZED_VIEW_SQL,
} from "./drizzle/queries/seo-intelligence";
export * from "./drizzle/zod-seo-intelligence";

// Publishing Suite queries and schemas (Phase 2B)
export {
	getPublishTargetById,
	upsertPublishTarget,
	togglePublishTarget,
	deletePublishTarget,
	getPublishingJobsForOrg,
	bulkCreatePublishingJobs,
	updatePublishingJobStatus,
	cancelPublishingJob,
	getScheduledJobsInRange,
	getPublishAttemptsForJobFull,
	countAttemptsForJob,
	recordPublishAttempt,
	getFailedJobsForDLQ,
	retryPublishingJob,
	bulkRetryJobs,
	getFailedWebhookEvents,
	markWebhookEventFailed,
	incrementWebhookReplayCount,
	createWebhookEvent,
	getIntegrationsForDomain,
	upsertIntegration,
	toggleIntegration,
	getPublishAnalyticsForDomain,
	getPublishingJobStatusSummary,
	getPublishingJobStatusSummaryForOrg,
} from "./drizzle/queries/publishing-suite";
export * from "./drizzle/zod-publishing-suite";
