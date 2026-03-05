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
