// Prisma-based queries (Supastarter base)

// Advanced AI Agents queries, schemas, and Zod (Phase 3B)
export {
	claimSession,
	createAgent,
	createSession,
	createWorkflow,
	deleteAgent,
	deleteWorkflow,
	getActiveAgentsForOrg,
	getAgentAnalytics,
	getAgentById,
	getAgentsByIds,
	getAgentsForOrg,
	getSessionById,
	getSessionsForOrg,
	getWorkflowById,
	getWorkflowsForOrg,
	updateAgent,
	updateAgentMemory,
	updateSession,
	updateWorkflow,
} from "./drizzle/queries/ai-agents";
// Analytics & ROI queries and schemas (Phase 2C)
export {
	getBuyerAttributionForDomain,
	getBuyerAttributionForOrg,
	getDiligenceReport,
	getMonetizationDecayForOrg,
	getPortfolioRoiForOrg,
	getPortfolioRoiMaterializedView,
	getPortfolioTrend,
	getSellReadyScore,
	PORTFOLIO_ROI_MATERIALIZED_VIEW_SQL,
	REFRESH_PORTFOLIO_ROI_VIEW_SQL,
	upsertDiligenceCheck,
} from "./drizzle/queries/analytics-roi";
// Enterprise Readiness & Scaling queries, schemas, and Zod (Phase 3A)
export {
	addTeamMember,
	createOverageAlert,
	createScimToken,
	createTeam,
	createTeamActivity,
	deleteScimToken,
	deleteSsoProvider,
	deleteTeam,
	getActiveBillingTiers,
	getAuditEventsForExport,
	getAuditRetentionForOrg,
	getBillingTierById,
	getOrgTier,
	getOverageAlertsForOrg,
	getScimTokensForOrg,
	getSsoProviderByDomain,
	getSsoProviderById,
	getSsoProvidersForOrg,
	getTeamActivity,
	getTeamById,
	getTeamBySlug,
	getTeamMember,
	getTeamMembers,
	getTeamsForOrg,
	removeTeamMember,
	searchAuditEvents,
	seedDefaultBillingTiers,
	touchScimToken,
	updateOrgSeats,
	updateSsoProviderStatus,
	updateTeam,
	updateTeamMemberRole,
	upsertAuditRetention,
	upsertOrgTier,
	upsertSsoProvider,
} from "./drizzle/queries/enterprise";
// Growth & Marketing queries and schemas (Phase 2D)
export {
	completeReferral,
	createReferral,
	createWaitlistEntry,
	getReferralByCode,
	getReferralLeaderboard,
	getReferralStats,
	getReferralsByReferrer,
	getWaitlistEntryByEmail,
	getWaitlistEntryById,
	getWaitlistEntryByReferralCode,
	getWaitlistStats,
	grantReferralReward,
	listWaitlistEntries,
	updateWaitlistEntryStatus,
} from "./drizzle/queries/growth";
// Publishing Suite queries and schemas (Phase 2B)
export {
	bulkCreatePublishingJobs,
	bulkRetryJobs,
	bulkRetryJobsForOrg,
	cancelPublishingJob,
	claimPublishingJobForExecution,
	countAttemptsForJob,
	createWebhookEvent,
	deletePublishTarget,
	getFailedJobsForDLQ,
	getFailedWebhookEvents,
	getIntegrationsForDomain,
	getPublishAnalyticsForDomain,
	getPublishAttemptsForJobFull,
	getPublishingJobStatusSummary,
	getPublishingJobStatusSummaryForOrg,
	getPublishingJobsForOrg,
	getPublishTargetById,
	getScheduledJobsInRange,
	incrementWebhookReplayCount,
	markWebhookEventFailed,
	recordPublishAttempt,
	retryPublishingJob,
	retryPublishingJobForOrg,
	toggleIntegration,
	togglePublishTarget,
	updatePublishingJobStatus,
	upsertIntegration,
	upsertPublishTarget,
} from "./drizzle/queries/publishing-suite";
// SEO Intelligence queries and schemas (Phase 2A)
export {
	bulkUpsertKeywords,
	getKeywordClusters,
	getKeywordsByDomain,
	getOrgSeoOverview,
	getSeoDashboardSummary,
	getStaleKeywords,
	recalculateDecayFactor,
	SEO_DASHBOARD_MATERIALIZED_VIEW_SQL,
	updateKeywordMetrics,
	updateSeoAhrefsData,
	updateSeoGscData,
	updateSeoScore,
} from "./drizzle/queries/seo-intelligence";
// Drizzle-based queries and schemas (SmartBeak v9)
export * from "./drizzle/queries/smartbeak";
export * from "./drizzle/schema/ai-agents";
export * from "./drizzle/schema/enterprise";
export * from "./drizzle/schema/growth";
export * from "./drizzle/schema/smartbeak";
export * from "./drizzle/zod-ai-agents";
export {
	BuyerAttributionResponseSchema,
	CreateBuyerSessionInputSchema,
	DiligenceReportSchema,
	DomainAnalyticsInputSchema,
	DomainDecayAnalyticsSchema,
	DomainRoiSchema,
	OrgSlugInputSchema,
	PortfolioRoiResponseSchema,
	PortfolioTrendInputSchema,
	PortfolioTrendPointSchema,
	RunDiligenceInputSchema,
	SellReadyRecommendationSchema,
	SellReadyScoreResponseSchema,
} from "./drizzle/zod-analytics-roi";
export * from "./drizzle/zod-enterprise";
export * from "./drizzle/zod-growth";
export type { PublishTarget as PublishingSuiteTarget } from "./drizzle/zod-publishing-suite";
export {
	bulkScheduleInputSchema,
	bulkScheduleItemSchema,
	dlqJobSchema,
	emailConfigSchema,
	emailSeriesInputSchema,
	emailSeriesStepSchema,
	instagramConfigSchema,
	linkedinConfigSchema,
	PUBLISH_TARGETS,
	pinterestConfigSchema,
	platformConfigSchema,
	publishAnalyticsRowSchema,
	publishTargetSchema,
	tiktokConfigSchema,
	unifiedJobSchema,
	vimeoConfigSchema,
	webConfigSchema,
	youtubeConfigSchema,
} from "./drizzle/zod-publishing-suite";
export * from "./drizzle/zod-seo-intelligence";
export * from "./drizzle/zod-smartbeak";
export * from "./prisma";
