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
	retryPublishingJobForOrg,
	bulkRetryJobs,
	bulkRetryJobsForOrg,
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
export {
	PUBLISH_TARGETS,
	publishTargetSchema,
	linkedinConfigSchema,
	youtubeConfigSchema,
	tiktokConfigSchema,
	instagramConfigSchema,
	pinterestConfigSchema,
	vimeoConfigSchema,
	emailConfigSchema,
	webConfigSchema,
	platformConfigSchema,
	bulkScheduleItemSchema,
	bulkScheduleInputSchema,
	emailSeriesStepSchema,
	emailSeriesInputSchema,
	publishAnalyticsRowSchema,
	dlqJobSchema,
	unifiedJobSchema,
} from "./drizzle/zod-publishing-suite";
export type { PublishTarget as PublishingSuiteTarget } from "./drizzle/zod-publishing-suite";

// Analytics & ROI queries and schemas (Phase 2C)
export {
	getPortfolioRoiForOrg,
	getDiligenceReport,
	upsertDiligenceCheck,
	runDiligenceChecksForDomain,
	getSellReadyScore,
	getBuyerAttributionForDomain,
	getBuyerAttributionForOrg,
	getMonetizationDecayForOrg,
	getPortfolioTrend,
	PORTFOLIO_ROI_MATERIALIZED_VIEW_SQL,
	REFRESH_PORTFOLIO_ROI_VIEW_SQL,
	getPortfolioRoiMaterializedView,
} from "./drizzle/queries/analytics-roi";
export {
	DomainRoiSchema,
	PortfolioRoiResponseSchema,
	DiligenceReportSchema,
	RunDiligenceInputSchema,
	SellReadyRecommendationSchema,
	SellReadyScoreResponseSchema,
	BuyerAttributionResponseSchema,
	CreateBuyerSessionInputSchema,
	DomainDecayAnalyticsSchema,
	PortfolioTrendPointSchema,
	OrgSlugInputSchema,
	DomainAnalyticsInputSchema,
	PortfolioTrendInputSchema,
} from "./drizzle/zod-analytics-roi";

// Growth & Marketing queries and schemas (Phase 2D)
export {
	getWaitlistEntryByEmail,
	getWaitlistEntryByReferralCode,
	getWaitlistEntryById,
	createWaitlistEntry,
	listWaitlistEntries,
	updateWaitlistEntryStatus,
	getWaitlistStats,
	getReferralByCode,
	createReferral,
	completeReferral,
	getReferralsByReferrer,
	getReferralLeaderboard,
	getReferralStats,
	grantReferralReward,
} from "./drizzle/queries/growth";
export * from "./drizzle/zod-growth";
export * from "./drizzle/schema/growth";

// Enterprise Readiness & Scaling queries, schemas, and Zod (Phase 3A)
export {
	getTeamsForOrg,
	getTeamById,
	getTeamBySlug,
	createTeam,
	updateTeam,
	deleteTeam,
	getTeamMembers,
	getTeamMember,
	addTeamMember,
	removeTeamMember,
	updateTeamMemberRole,
	getTeamActivity,
	createTeamActivity,
	getSsoProvidersForOrg,
	getSsoProviderById,
	getSsoProviderByDomain,
	upsertSsoProvider,
	updateSsoProviderStatus,
	deleteSsoProvider,
	getScimTokensForOrg,
	createScimToken,
	deleteScimToken,
	touchScimToken,
	getAuditRetentionForOrg,
	upsertAuditRetention,
	searchAuditEvents,
	getAuditEventsForExport,
	getActiveBillingTiers,
	getBillingTierById,
	getOrgTier,
	upsertOrgTier,
	updateOrgSeats,
	getOverageAlertsForOrg,
	createOverageAlert,
	seedDefaultBillingTiers,
} from "./drizzle/queries/enterprise";
export * from "./drizzle/zod-enterprise";
export * from "./drizzle/schema/enterprise";

// Advanced AI Agents queries, schemas, and Zod (Phase 3B)
export {
	getAgentsForOrg,
	getActiveAgentsForOrg,
	getAgentById,
	createAgent,
	updateAgent,
	updateAgentMemory,
	deleteAgent,
	getWorkflowsForOrg,
	getWorkflowById,
	createWorkflow,
	updateWorkflow,
	deleteWorkflow,
	createSession,
	updateSession,
	getSessionsForOrg,
	getSessionById,
	getAgentAnalytics,
	getAgentsByIds,
} from "./drizzle/queries/ai-agents";
export * from "./drizzle/zod-ai-agents";
export * from "./drizzle/schema/ai-agents";
