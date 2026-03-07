/**
 * Phase 2A — SEO Intelligence & AI Content
 * Extended database queries for keyword tracking, decay signals,
 * GSC/Ahrefs data, and SEO dashboard aggregations.
 *
 * All queries operate against the locked v9 schema tables only.
 * The keyword_tracking and seo_documents tables are used as-is.
 */

import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../client";
import { domains, keywordTracking, seoDocuments } from "../schema";

// ─── Keyword Tracking (extended) ──────────────────────────────────────────────

/**
 * Get all keywords for a domain with optional filters.
 */
export async function getKeywordsByDomain(
	domainId: string,
	opts?: {
		minVolume?: number;
		maxDifficulty?: number;
		hasPosition?: boolean;
		limit?: number;
		offset?: number;
	},
) {
	const conditions = [eq(keywordTracking.domainId, domainId)];
	if (opts?.minVolume !== undefined) {
		conditions.push(gte(keywordTracking.volume, opts.minVolume));
	}
	if (opts?.maxDifficulty !== undefined) {
		conditions.push(lte(keywordTracking.difficulty, opts.maxDifficulty));
	}
	if (opts?.hasPosition) {
		conditions.push(isNotNull(keywordTracking.position));
	}

	return db.query.keywordTracking.findMany({
		where: and(...conditions),
		orderBy: [asc(keywordTracking.position), desc(keywordTracking.volume)],
		limit: opts?.limit ?? 200,
		offset: opts?.offset ?? 0,
	});
}

/**
 * Get a single keyword by ID.
 */
export async function getKeywordById(id: string) {
	return db.query.keywordTracking.findFirst({
		where: eq(keywordTracking.id, id),
	});
}

/**
 * Update keyword metrics (position, volume, difficulty, decayFactor).
 */
export async function updateKeywordMetrics(
	id: string,
	data: {
		position?: number | null;
		volume?: number | null;
		difficulty?: number | null;
		decayFactor?: string | null;
		lastUpdated?: Date;
	},
) {
	return db
		.update(keywordTracking)
		.set({ ...data, lastUpdated: data.lastUpdated ?? new Date() })
		.where(eq(keywordTracking.id, id))
		.returning();
}

/**
 * Bulk upsert keywords for a domain (used by GSC/Ahrefs sync jobs).
 */
export async function bulkUpsertKeywords(
	rows: {
		domainId: string;
		keyword: string;
		volume?: number;
		difficulty?: number;
		position?: number;
		decayFactor?: string;
	}[],
) {
	if (rows.length === 0) {
		return [];
	}
	return db
		.insert(keywordTracking)
		.values(rows)
		.onConflictDoNothing()
		.returning();
}

/**
 * Get keywords that need decay recalculation (not updated in the last 24h).
 */
export async function getStaleKeywords(olderThanHours = 24) {
	const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
	return db.query.keywordTracking.findMany({
		where: lte(keywordTracking.lastUpdated, cutoff),
		orderBy: asc(keywordTracking.lastUpdated),
		limit: 500,
	});
}

/**
 * Compute and persist a decay factor for a keyword.
 * decayFactor = 1 - (daysSinceLastUpdate / 30) clamped to [0, 1].
 */
export async function recalculateDecayFactor(id: string, lastUpdated: Date) {
	const daysSince =
		(Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
	const decay = Math.max(0, Math.min(1, 1 - daysSince / 30));
	const decayFactor = decay.toFixed(4);
	return db
		.update(keywordTracking)
		.set({ decayFactor, lastUpdated: new Date() })
		.where(eq(keywordTracking.id, id))
		.returning();
}

// ─── SEO Document (extended) ──────────────────────────────────────────────────

/**
 * Update the SEO document with GSC data.
 */
export async function updateSeoGscData(
	domainId: string,
	gscData: Record<string, unknown>,
) {
	return db
		.update(seoDocuments)
		.set({ gscData, updatedAt: new Date() })
		.where(eq(seoDocuments.domainId, domainId))
		.returning();
}

/**
 * Update the SEO document with Ahrefs data.
 */
export async function updateSeoAhrefsData(
	domainId: string,
	ahrefsData: Record<string, unknown>,
) {
	return db
		.update(seoDocuments)
		.set({ ahrefsData, updatedAt: new Date() })
		.where(eq(seoDocuments.domainId, domainId))
		.returning();
}

/**
 * Update the SEO score and decay signals.
 */
export async function updateSeoScore(
	domainId: string,
	score: number,
	decaySignals: Record<string, unknown>,
) {
	return db
		.update(seoDocuments)
		.set({ score, decaySignals, updatedAt: new Date() })
		.where(eq(seoDocuments.domainId, domainId))
		.returning();
}

// ─── SEO Dashboard Aggregations ───────────────────────────────────────────────

/**
 * Get SEO dashboard summary for a domain:
 * keyword count, avg position, avg difficulty, avg volume, avg decay.
 */
export async function getSeoDashboardSummary(domainId: string) {
	const [summary] = await db
		.select({
			totalKeywords: sql<number>`count(*)::int`,
			avgPosition: sql<number>`round(avg(${keywordTracking.position}))::int`,
			avgDifficulty: sql<number>`round(avg(${keywordTracking.difficulty}))::int`,
			avgVolume: sql<number>`round(avg(${keywordTracking.volume}))::int`,
			avgDecay: sql<number>`round(avg(${keywordTracking.decayFactor}::numeric) * 100)::int`,
			topPositionKeywords: sql<number>`count(*) filter (where ${keywordTracking.position} <= 10)::int`,
			decayingKeywords: sql<number>`count(*) filter (where ${keywordTracking.decayFactor}::numeric < 0.5)::int`,
		})
		.from(keywordTracking)
		.where(eq(keywordTracking.domainId, domainId));

	const seoDoc = await db.query.seoDocuments.findFirst({
		where: eq(seoDocuments.domainId, domainId),
	});

	return {
		...summary,
		seoScore: seoDoc?.score ?? 0,
		gscConnected: !!seoDoc?.gscData,
		ahrefsConnected: !!seoDoc?.ahrefsData,
	};
}

/**
 * Get keyword clusters: group keywords by first word (topic cluster).
 */
export async function getKeywordClusters(domainId: string) {
	return db
		.select({
			cluster: sql<string>`split_part(${keywordTracking.keyword}, ' ', 1)`,
			count: sql<number>`count(*)::int`,
			avgPosition: sql<number>`round(avg(${keywordTracking.position}))::int`,
			totalVolume: sql<number>`sum(${keywordTracking.volume})::int`,
		})
		.from(keywordTracking)
		.where(eq(keywordTracking.domainId, domainId))
		.groupBy(sql`split_part(${keywordTracking.keyword}, ' ', 1)`)
		.orderBy(desc(sql`count(*)`))
		.limit(20);
}

/**
 * Get org-level SEO overview: all domains with their SEO scores and keyword counts.
 */
export async function getOrgSeoOverview(orgId: string) {
	return db
		.select({
			domainId: domains.id,
			domainName: domains.name,
			seoScore: seoDocuments.score,
			keywordCount: sql<number>`count(${keywordTracking.id})::int`,
			avgPosition: sql<number>`round(avg(${keywordTracking.position}))::int`,
			decayingCount: sql<number>`count(${keywordTracking.id}) filter (where ${keywordTracking.decayFactor}::numeric < 0.5)::int`,
		})
		.from(domains)
		.leftJoin(seoDocuments, eq(seoDocuments.domainId, domains.id))
		.leftJoin(keywordTracking, eq(keywordTracking.domainId, domains.id))
		.where(eq(domains.orgId, orgId))
		.groupBy(domains.id, domains.name, seoDocuments.score)
		.orderBy(desc(seoDocuments.score))
		.limit(200);
}

// ─── Materialized View SQL ────────────────────────────────────────────────────
// These are the raw SQL strings used to create/refresh the materialized view.
// Execute via a migration or the Supabase SQL editor.

export const SEO_DASHBOARD_MATERIALIZED_VIEW_SQL = `
-- Phase 2A: SEO Intelligence materialized view
-- Provides fast dashboard queries without real-time aggregation cost.
-- Refresh via: SELECT refresh_seo_dashboard();

CREATE MATERIALIZED VIEW IF NOT EXISTS seo_dashboard_mv AS
SELECT
  d.id                                                          AS domain_id,
  d.org_id,
  d.name                                                        AS domain_name,
  COALESCE(sd.score, 0)                                         AS seo_score,
  COUNT(kt.id)::int                                             AS keyword_count,
  ROUND(AVG(kt.position))::int                                  AS avg_position,
  ROUND(AVG(kt.volume))::int                                    AS avg_volume,
  ROUND(AVG(kt.difficulty))::int                                AS avg_difficulty,
  ROUND(AVG(kt.decay_factor::numeric) * 100)::int               AS avg_decay_pct,
  COUNT(kt.id) FILTER (WHERE kt.position <= 10)::int            AS top10_count,
  COUNT(kt.id) FILTER (WHERE kt.decay_factor::numeric < 0.5)::int AS decaying_count,
  sd.gsc_data IS NOT NULL                                       AS gsc_connected,
  sd.ahrefs_data IS NOT NULL                                    AS ahrefs_connected,
  NOW()                                                         AS refreshed_at
FROM domains d
LEFT JOIN seo_documents sd ON sd.domain_id = d.id
LEFT JOIN keyword_tracking kt ON kt.domain_id = d.id
GROUP BY d.id, d.org_id, d.name, sd.score, sd.gsc_data, sd.ahrefs_data;

CREATE UNIQUE INDEX IF NOT EXISTS seo_dashboard_mv_domain_id_idx
  ON seo_dashboard_mv (domain_id);

CREATE OR REPLACE FUNCTION refresh_seo_dashboard()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY seo_dashboard_mv;
END;
$$;

-- RLS: only org members can read their own rows
ALTER MATERIALIZED VIEW seo_dashboard_mv ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_read_seo_dashboard"
  ON seo_dashboard_mv FOR SELECT
  USING (
    org_id IN (
      SELECT organization_id FROM member WHERE user_id = auth.uid()
    )
  );
`;
