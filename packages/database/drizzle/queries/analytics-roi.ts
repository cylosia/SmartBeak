/**
 * Phase 2C — Advanced Analytics & ROI DB Queries
 * Uses only locked v9 schema tables. No schema modifications.
 */

import { logger } from "@repo/logs";
import { and, avg, count, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../client";
import {
	buyerSessions,
	diligenceChecks,
	domains,
	monetizationDecaySignals,
	portfolioSummaries,
	timelineEvents,
} from "../schema";

function extractHealthScore(health: unknown, fallback = 0): number {
	if (typeof health === "number") {
		return health;
	}
	if (health && typeof health === "object" && "score" in health) {
		return typeof (health as Record<string, unknown>).score === "number"
			? ((health as Record<string, unknown>).score as number)
			: fallback;
	}
	return fallback;
}

// ─── Portfolio ROI ──────────────────────────────────────────────────────────

export async function getPortfolioRoiForOrg(orgId: string) {
	const summary = await db.query.portfolioSummaries.findFirst({
		where: eq(portfolioSummaries.orgId, orgId),
	});

	const domainList = await db.query.domains.findMany({
		where: eq(domains.orgId, orgId),
		columns: {
			id: true,
			name: true,
			health: true,
			status: true,
			createdAt: true,
		},
		limit: 500,
	});

	const decayRows = await db
		.select({
			domainId: monetizationDecaySignals.domainId,
			avgDecay: avg(monetizationDecaySignals.decayFactor),
			count: count(),
		})
		.from(monetizationDecaySignals)
		.where(
			eq(
				monetizationDecaySignals.domainId,
				sql`ANY(ARRAY[${sql.join(
					domainList.map((d) => sql`${d.id}::uuid`),
					sql`, `,
				)}])`,
			),
		)
		.groupBy(monetizationDecaySignals.domainId);

	const decayMap = new Map(
		decayRows.map((r) => [
			r.domainId,
			{ avgDecay: Number(r.avgDecay ?? 0), count: r.count },
		]),
	);

	const domainsWithRoi = domainList.map((d) => {
		const decay = decayMap.get(d.id);
		const healthScore = extractHealthScore(d.health);
		const decayFactor = decay?.avgDecay ?? 1;
		// Risk-adjusted ROI: health score weighted by decay factor
		const riskAdjustedScore =
			Math.round(healthScore * decayFactor * 100) / 100;
		return {
			...d,
			healthScore,
			riskAdjustedScore,
			decayFactor,
			estimatedValue: riskAdjustedScore * 1000, // placeholder multiplier
		};
	});

	const totalValue = domainsWithRoi.reduce(
		(sum, d) => sum + d.estimatedValue,
		0,
	);
	const avgRoi =
		domainsWithRoi.length > 0
			? domainsWithRoi.reduce((sum, d) => sum + d.riskAdjustedScore, 0) /
				domainsWithRoi.length
			: 0;

	return {
		summary,
		domains: domainsWithRoi,
		totalValue,
		avgRoi: Math.round(avgRoi * 100) / 100,
		totalDomains: domainList.length,
	};
}

export async function upsertPortfolioSummary(data: {
	orgId: string;
	totalDomains: number;
	totalValue: string;
	avgRoi: string;
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.portfolioSummaries.findFirst({
			where: eq(portfolioSummaries.orgId, data.orgId),
		});
		if (existing) {
			return tx
				.update(portfolioSummaries)
				.set({ ...data, lastUpdated: new Date() })
				.where(eq(portfolioSummaries.id, existing.id))
				.returning();
		}
		return tx.insert(portfolioSummaries).values(data).returning();
	});
}

// ─── Diligence Engine ────────────────────────────────────────────────────────

export async function getDiligenceReport(domainId: string) {
	const checks = await db.query.diligenceChecks.findMany({
		where: eq(diligenceChecks.domainId, domainId),
		orderBy: [desc(diligenceChecks.completedAt)],
		limit: 200,
	});

	const total = checks.length;
	const passed = checks.filter((c) => c.status === "passed").length;
	const failed = checks.filter((c) => c.status === "failed").length;
	const pending = checks.filter((c) => c.status === "pending").length;
	const score = total > 0 ? Math.round((passed / total) * 100) : 0;

	const byType = checks.reduce<Record<string, typeof checks>>((acc, c) => {
		if (!acc[c.type]) {
			acc[c.type] = [];
		}
		acc[c.type].push(c);
		return acc;
	}, {});

	return { checks, total, passed, failed, pending, score, byType };
}

export async function upsertDiligenceCheck(data: {
	domainId: string;
	type: string;
	result?: Record<string, unknown>;
	status?: string;
	completedAt?: Date;
}) {
	return db.transaction(async (tx) => {
		const existing = await tx.query.diligenceChecks.findFirst({
			where: and(
				eq(diligenceChecks.domainId, data.domainId),
				eq(diligenceChecks.type, data.type),
			),
		});
		if (existing) {
			return tx
				.update(diligenceChecks)
				.set({
					result: data.result ?? existing.result,
					status: data.status ?? existing.status,
					completedAt: data.completedAt ?? existing.completedAt,
				})
				.where(eq(diligenceChecks.id, existing.id))
				.returning();
		}
		return tx.insert(diligenceChecks).values(data).returning();
	});
}

export async function runDiligenceChecksForDomain(domainId: string) {
	const DILIGENCE_TYPES = [
		"ownership",
		"legal",
		"financial",
		"traffic",
		"content",
		"technical",
		"brand",
		"monetization",
	];

	const domain = await db.query.domains.findFirst({
		where: eq(domains.id, domainId),
	});
	if (!domain) {
		return [];
	}

	const results = await Promise.all(
		DILIGENCE_TYPES.map(async (type) => {
			const healthScore = extractHealthScore(domain.health, 50);
			const typeWeights: Record<string, number> = {
				ownership: 1.0,
				legal: 0.95,
				financial: 0.9,
				traffic: healthScore / 100,
				content: healthScore / 100,
				technical: 0.85,
				brand: 0.8,
				monetization: 0.75,
			};
			const weight = typeWeights[type] ?? 0.8;
			const pass = weight >= 0.75;
			return upsertDiligenceCheck({
				domainId,
				type,
				result: { weight, healthScore, automated: true },
				status: pass ? "passed" : "failed",
				completedAt: new Date(),
			});
		}),
	);

	return results.flat();
}

// ─── Sell-Ready Score ────────────────────────────────────────────────────────

export async function getSellReadyScore(domainId: string) {
	const [domain, diligence, decay, sessionCountResult, timeline] =
		await Promise.all([
			db.query.domains.findFirst({ where: eq(domains.id, domainId) }),
			getDiligenceReport(domainId),
			db.query.monetizationDecaySignals.findMany({
				where: eq(monetizationDecaySignals.domainId, domainId),
				orderBy: [desc(monetizationDecaySignals.recordedAt)],
				limit: 10,
			}),
			db
				.select({ count: sql<number>`count(*)::int` })
				.from(buyerSessions)
				.where(eq(buyerSessions.domainId, domainId)),
			db.query.timelineEvents.findMany({
				where: eq(timelineEvents.domainId, domainId),
				orderBy: [desc(timelineEvents.createdAt)],
				limit: 20,
			}),
		]);

	if (!domain) {
		return null;
	}

	const buyerSessionCount = sessionCountResult[0]?.count ?? 0;
	const healthScore = extractHealthScore(domain.health);
	const diligenceScore = Number.isFinite(diligence.score)
		? diligence.score
		: 0;
	const avgDecay =
		decay.length > 0
			? decay.reduce((sum, d) => {
					const val = Number(d.decayFactor);
					return sum + (Number.isFinite(val) ? val : 0);
				}, 0) / decay.length
			: 1;
	const buyerInterest = Math.min(buyerSessionCount * 5, 30);
	const timelineActivity = Math.min(timeline.length * 2, 20);

	const rawScore =
		healthScore * 0.25 +
		diligenceScore * 0.3 +
		avgDecay * 100 * 0.2 +
		buyerInterest +
		timelineActivity;
	const sellReadyScore = Number.isFinite(rawScore) ? Math.round(rawScore) : 0;

	const recommendations: Array<{
		area: string;
		message: string;
		priority: "high" | "medium" | "low";
	}> = [];

	if (healthScore < 70) {
		recommendations.push({
			area: "Health",
			message: "Improve domain health score above 70 before listing.",
			priority: "high",
		});
	}
	if (diligenceScore < 80) {
		recommendations.push({
			area: "Diligence",
			message:
				"Complete all diligence checks — especially ownership and legal.",
			priority: "high",
		});
	}
	if (avgDecay < 0.7) {
		recommendations.push({
			area: "Monetization",
			message:
				"Address monetization decay signals to improve revenue stability.",
			priority: "high",
		});
	}
	if (buyerSessionCount < 5) {
		recommendations.push({
			area: "Buyer Interest",
			message:
				"Increase buyer session activity through targeted outreach.",
			priority: "medium",
		});
	}
	if (timeline.length < 10) {
		recommendations.push({
			area: "Timeline",
			message:
				"Add more timeline events to demonstrate active management.",
			priority: "low",
		});
	}

	return {
		score: Math.min(sellReadyScore, 100),
		breakdown: {
			health: Math.round(healthScore * 0.25),
			diligence: Math.round(diligenceScore * 0.3),
			monetization: Math.round(avgDecay * 100 * 0.2),
			buyerInterest,
			timelineActivity,
		},
		recommendations,
		domain,
		diligence,
		avgDecay,
		buyerSessionCount,
	};
}

// ─── Buyer Attribution ───────────────────────────────────────────────────────

export async function getBuyerAttributionForDomain(domainId: string) {
	const domainFilter = eq(buyerSessions.domainId, domainId);

	const [
		intentBreakdown,
		conversionResult,
		dailyTrend,
		sessions,
	] = await Promise.all([
		db
			.select({
				intent: sql<string>`COALESCE(${buyerSessions.intent}, 'unknown')`,
				count: sql<number>`count(*)::int`,
			})
			.from(buyerSessions)
			.where(domainFilter)
			.groupBy(buyerSessions.intent),

		db
			.select({
				total: sql<number>`count(*)::int`,
				converted: sql<number>`count(*) FILTER (WHERE ${buyerSessions.buyerEmail} IS NOT NULL)::int`,
			})
			.from(buyerSessions)
			.where(domainFilter),

		db
			.select({
				date: sql<string>`DATE(${buyerSessions.createdAt})`,
				count: sql<number>`count(*)::int`,
			})
			.from(buyerSessions)
			.where(domainFilter)
			.groupBy(sql`DATE(${buyerSessions.createdAt})`)
			.orderBy(sql`DATE(${buyerSessions.createdAt})`)
			.limit(30),

		db.query.buyerSessions.findMany({
			where: domainFilter,
			orderBy: [desc(buyerSessions.createdAt)],
			limit: 100,
		}),
	]);

	const total = conversionResult[0]?.total ?? 0;
	const converted = conversionResult[0]?.converted ?? 0;
	const conversionRate =
		total > 0 ? Math.round((converted / total) * 100) : 0;

	return {
		sessions,
		total,
		converted,
		conversionRate,
		intentBreakdown: intentBreakdown.map((r) => ({
			intent: r.intent,
			count: r.count,
		})),
		dailyTrend: dailyTrend.map((r) => ({
			date: String(r.date),
			count: r.count,
		})),
	};
}

export async function getBuyerAttributionForOrg(orgId: string) {
	const orgDomains = await db.query.domains.findMany({
		where: eq(domains.orgId, orgId),
		columns: { id: true, name: true },
		limit: 500,
	});

	if (orgDomains.length === 0) {
		return {
			domains: [],
			totalSessions: 0,
			totalConverted: 0,
			overallConversionRate: 0,
		};
	}

	const domainIds = orgDomains.map((d) => d.id);
	const domainArrayFilter = sql`${buyerSessions.domainId} = ANY(ARRAY[${sql.join(
		domainIds.map((id) => sql`${id}::uuid`),
		sql`, `,
	)}])`;

	const [domainStats, intentRows, dailyRows, recentSessions] =
		await Promise.all([
			db
				.select({
					domainId: buyerSessions.domainId,
					total: sql<number>`count(*)::int`,
					converted: sql<number>`count(*) FILTER (WHERE ${buyerSessions.buyerEmail} IS NOT NULL)::int`,
				})
				.from(buyerSessions)
				.where(domainArrayFilter)
				.groupBy(buyerSessions.domainId),

			db
				.select({
					domainId: buyerSessions.domainId,
					intent: sql<string>`COALESCE(${buyerSessions.intent}, 'unknown')`,
					count: sql<number>`count(*)::int`,
				})
				.from(buyerSessions)
				.where(domainArrayFilter)
				.groupBy(buyerSessions.domainId, buyerSessions.intent),

			db
				.select({
					domainId: buyerSessions.domainId,
					date: sql<string>`DATE(${buyerSessions.createdAt})`,
					count: sql<number>`count(*)::int`,
				})
				.from(buyerSessions)
				.where(domainArrayFilter)
				.groupBy(
					buyerSessions.domainId,
					sql`DATE(${buyerSessions.createdAt})`,
				)
				.orderBy(
					buyerSessions.domainId,
					sql`DATE(${buyerSessions.createdAt})`,
				),

			db.query.buyerSessions.findMany({
				where: domainArrayFilter,
				orderBy: [desc(buyerSessions.createdAt)],
				limit: 100,
			}),
		]);

	const statsMap = new Map(domainStats.map((r) => [r.domainId, r]));

	const intentMap = new Map<
		string,
		Array<{ intent: string; count: number }>
	>();
	for (const r of intentRows) {
		const list = intentMap.get(r.domainId) ?? [];
		list.push({ intent: r.intent, count: r.count });
		intentMap.set(r.domainId, list);
	}

	const dailyMap = new Map<
		string,
		Array<{ date: string; count: number }>
	>();
	for (const r of dailyRows) {
		const list = dailyMap.get(r.domainId) ?? [];
		list.push({ date: String(r.date), count: r.count });
		dailyMap.set(r.domainId, list);
	}

	const sessionsByDomain = new Map<string, typeof recentSessions>();
	for (const s of recentSessions) {
		const list = sessionsByDomain.get(s.domainId) ?? [];
		list.push(s);
		sessionsByDomain.set(s.domainId, list);
	}

	const results = orgDomains.map((d) => {
		const stats = statsMap.get(d.id);
		const total = stats?.total ?? 0;
		const converted = stats?.converted ?? 0;
		const conversionRate =
			total > 0 ? Math.round((converted / total) * 100) : 0;

		return {
			domain: d,
			sessions: sessionsByDomain.get(d.id) ?? [],
			total,
			converted,
			conversionRate,
			intentBreakdown: intentMap.get(d.id) ?? [],
			dailyTrend: (dailyMap.get(d.id) ?? []).slice(-30),
		};
	});

	const totalSessions = results.reduce((sum, r) => sum + r.total, 0);
	const totalConverted = results.reduce((sum, r) => sum + r.converted, 0);
	const overallConversionRate =
		totalSessions > 0
			? Math.round((totalConverted / totalSessions) * 100)
			: 0;

	return {
		domains: results,
		totalSessions,
		totalConverted,
		overallConversionRate,
	};
}

// ─── Advanced Analytics / Monetization Decay ─────────────────────────────────

export async function getMonetizationDecayForOrg(orgId: string) {
	const orgDomains = await db.query.domains.findMany({
		where: eq(domains.orgId, orgId),
		columns: { id: true, name: true, health: true },
		limit: 500,
	});

	if (orgDomains.length === 0) {
		return [];
	}

	const domainIds = orgDomains.map((d) => d.id);
	const domainArrayFilter = sql`${monetizationDecaySignals.domainId} = ANY(ARRAY[${sql.join(
		domainIds.map((id) => sql`${id}::uuid`),
		sql`, `,
	)}])`;

	const domainDecay = await db
		.select({
			domainId: monetizationDecaySignals.domainId,
			avgDecay: sql<number>`avg(${monetizationDecaySignals.decayFactor})::float`,
			signalCount: sql<number>`count(*)::int`,
		})
		.from(monetizationDecaySignals)
		.where(domainArrayFilter)
		.groupBy(monetizationDecaySignals.domainId);

	const decayMap = new Map(
		domainDecay.map((r) => [
			r.domainId,
			{
				avgDecay: r.avgDecay ?? 1,
				signalCount: r.signalCount,
			},
		]),
	);

	return orgDomains.map((d) => {
		const decay = decayMap.get(d.id);
		const avgDecay = decay?.avgDecay ?? 1;
		return {
			domain: d,
			signals: [],
			avgDecay: Math.round(avgDecay * 10000) / 10000,
		};
	});
}

export async function getPortfolioTrend(orgId: string, days = 30) {
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

	const orgDomains = await db.query.domains.findMany({
		where: eq(domains.orgId, orgId),
		columns: { id: true },
		limit: 500,
	});

	const domainIds = orgDomains.map((d) => d.id);
	if (domainIds.length === 0) {
		return [];
	}

	const dailyTrend = await db
		.select({
			date: sql<string>`DATE(${monetizationDecaySignals.recordedAt})`,
			avgDecay: sql<number>`avg(${monetizationDecaySignals.decayFactor})::float`,
		})
		.from(monetizationDecaySignals)
		.where(
			and(
				sql`${monetizationDecaySignals.domainId} = ANY(ARRAY[${sql.join(
					domainIds.map((id) => sql`${id}::uuid`),
					sql`, `,
				)}])`,
				gte(monetizationDecaySignals.recordedAt, since),
			),
		)
		.groupBy(sql`DATE(${monetizationDecaySignals.recordedAt})`)
		.orderBy(sql`DATE(${monetizationDecaySignals.recordedAt})`);

	return dailyTrend.map((r) => ({
		date: String(r.date),
		avgDecay: Math.round((r.avgDecay ?? 0) * 10000) / 10000,
	}));
}

// ─── Materialized View SQL ────────────────────────────────────────────────────

export const PORTFOLIO_ROI_MATERIALIZED_VIEW_SQL = `
CREATE MATERIALIZED VIEW IF NOT EXISTS portfolio_roi_summary AS
SELECT
  ps.org_id,
  ps.total_domains,
  ps.total_value,
  ps.avg_roi,
  ps.last_updated,
  COUNT(DISTINCT d.id) AS active_domains,
  AVG(CAST(d.health->>'score' AS NUMERIC)) AS avg_health_score,
  COUNT(DISTINCT bs.id) AS total_buyer_sessions,
  COUNT(DISTINCT dc.id) FILTER (WHERE dc.status = 'passed') AS diligence_passed,
  COUNT(DISTINCT dc.id) FILTER (WHERE dc.status = 'failed') AS diligence_failed
FROM portfolio_summaries ps
LEFT JOIN domains d ON d.org_id = ps.org_id AND d.status = 'active'
LEFT JOIN buyer_sessions bs ON bs.domain_id = d.id
LEFT JOIN diligence_checks dc ON dc.domain_id = d.id
GROUP BY ps.id, ps.org_id, ps.total_domains, ps.total_value, ps.avg_roi, ps.last_updated
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS portfolio_roi_summary_org_id_idx ON portfolio_roi_summary (org_id);
`;

export const REFRESH_PORTFOLIO_ROI_VIEW_SQL =
	"REFRESH MATERIALIZED VIEW CONCURRENTLY portfolio_roi_summary;";

export async function getPortfolioRoiMaterializedView(orgId: string) {
	try {
		const result = await db.execute(
			sql`SELECT * FROM portfolio_roi_summary WHERE org_id = ${orgId}`,
		);
		return result.rows[0] ?? null;
	} catch (err) {
		logger.warn("[analytics-roi] materialized view error:", err);
		return null;
	}
}
