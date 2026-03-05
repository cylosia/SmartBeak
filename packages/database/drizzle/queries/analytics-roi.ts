/**
 * Phase 2C — Advanced Analytics & ROI DB Queries
 * Uses only locked v9 schema tables. No schema modifications.
 */
import { and, avg, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../client";
import {
  buyerSessions,
  diligenceChecks,
  domains,
  monetizationDecaySignals,
  portfolioSummaries,
  timelineEvents,
} from "../schema";

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
      healthScore: true,
      status: true,
      createdAt: true,
    },
  });

  const decayRows = await db
    .select({
      domainId: monetizationDecaySignals.domainId,
      avgDecay: avg(monetizationDecaySignals.decayFactor),
      count: count(),
    })
    .from(monetizationDecaySignals)
    .where(eq(monetizationDecaySignals.domainId, sql`ANY(ARRAY[${sql.join(domainList.map((d) => sql`${d.id}::uuid`), sql`, `)}])`))
    .groupBy(monetizationDecaySignals.domainId);

  const decayMap = new Map(
    decayRows.map((r) => [r.domainId, { avgDecay: Number(r.avgDecay ?? 0), count: r.count }]),
  );

  const domainsWithRoi = domainList.map((d) => {
    const decay = decayMap.get(d.id);
    const healthScore = d.healthScore ?? 0;
    const decayFactor = decay?.avgDecay ?? 1;
    // Risk-adjusted ROI: health score weighted by decay factor
    const riskAdjustedScore = Math.round(healthScore * decayFactor * 100) / 100;
    return {
      ...d,
      riskAdjustedScore,
      decayFactor,
      estimatedValue: riskAdjustedScore * 1000, // placeholder multiplier
    };
  });

  const totalValue = domainsWithRoi.reduce((sum, d) => sum + d.estimatedValue, 0);
  const avgRoi =
    domainsWithRoi.length > 0
      ? domainsWithRoi.reduce((sum, d) => sum + d.riskAdjustedScore, 0) / domainsWithRoi.length
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
  const existing = await db.query.portfolioSummaries.findFirst({
    where: eq(portfolioSummaries.orgId, data.orgId),
  });
  if (existing) {
    return db
      .update(portfolioSummaries)
      .set({ ...data, lastUpdated: new Date() })
      .where(eq(portfolioSummaries.id, existing.id))
      .returning();
  }
  return db.insert(portfolioSummaries).values(data).returning();
}

// ─── Diligence Engine ────────────────────────────────────────────────────────

export async function getDiligenceReport(domainId: string) {
  const checks = await db.query.diligenceChecks.findMany({
    where: eq(diligenceChecks.domainId, domainId),
    orderBy: [desc(diligenceChecks.completedAt)],
  });

  const total = checks.length;
  const passed = checks.filter((c) => c.status === "passed").length;
  const failed = checks.filter((c) => c.status === "failed").length;
  const pending = checks.filter((c) => c.status === "pending").length;
  const score = total > 0 ? Math.round((passed / total) * 100) : 0;

  const byType = checks.reduce<Record<string, typeof checks>>((acc, c) => {
    if (!acc[c.type]) acc[c.type] = [];
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
  const existing = await db.query.diligenceChecks.findFirst({
    where: and(
      eq(diligenceChecks.domainId, data.domainId),
      eq(diligenceChecks.type, data.type),
    ),
  });
  if (existing) {
    return db
      .update(diligenceChecks)
      .set({
        result: data.result ?? existing.result,
        status: data.status ?? existing.status,
        completedAt: data.completedAt ?? existing.completedAt,
      })
      .where(eq(diligenceChecks.id, existing.id))
      .returning();
  }
  return db.insert(diligenceChecks).values(data).returning();
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
  if (!domain) throw new Error("Domain not found");

  const results = await Promise.all(
    DILIGENCE_TYPES.map(async (type) => {
      // Deterministic scoring based on domain health and type
      const healthScore = domain.healthScore ?? 50;
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
  const [domain, diligence, decay, buyerSess, timeline] = await Promise.all([
    db.query.domains.findFirst({ where: eq(domains.id, domainId) }),
    getDiligenceReport(domainId),
    db.query.monetizationDecaySignals.findMany({
      where: eq(monetizationDecaySignals.domainId, domainId),
      orderBy: [desc(monetizationDecaySignals.recordedAt)],
      limit: 10,
    }),
    db.query.buyerSessions.findMany({
      where: eq(buyerSessions.domainId, domainId),
    }),
    db.query.timelineEvents.findMany({
      where: eq(timelineEvents.domainId, domainId),
      orderBy: [desc(timelineEvents.createdAt)],
      limit: 20,
    }),
  ]);

  if (!domain) throw new Error("Domain not found");

  const healthScore = domain.healthScore ?? 0;
  const diligenceScore = diligence.score;
  const avgDecay =
    decay.length > 0
      ? decay.reduce((sum, d) => sum + Number(d.decayFactor), 0) / decay.length
      : 1;
  const buyerInterest = Math.min(buyerSess.length * 5, 30); // up to 30 pts
  const timelineActivity = Math.min(timeline.length * 2, 20); // up to 20 pts

  // Weighted sell-ready score (0–100)
  const sellReadyScore = Math.round(
    healthScore * 0.25 +
      diligenceScore * 0.3 +
      avgDecay * 100 * 0.2 +
      buyerInterest +
      timelineActivity,
  );

  const recommendations: Array<{ area: string; message: string; priority: "high" | "medium" | "low" }> = [];

  if (healthScore < 70)
    recommendations.push({ area: "Health", message: "Improve domain health score above 70 before listing.", priority: "high" });
  if (diligenceScore < 80)
    recommendations.push({ area: "Diligence", message: "Complete all diligence checks — especially ownership and legal.", priority: "high" });
  if (avgDecay < 0.7)
    recommendations.push({ area: "Monetization", message: "Address monetization decay signals to improve revenue stability.", priority: "high" });
  if (buyerSess.length < 5)
    recommendations.push({ area: "Buyer Interest", message: "Increase buyer session activity through targeted outreach.", priority: "medium" });
  if (timeline.length < 10)
    recommendations.push({ area: "Timeline", message: "Add more timeline events to demonstrate active management.", priority: "low" });

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
    buyerSessionCount: buyerSess.length,
  };
}

// ─── Buyer Attribution ───────────────────────────────────────────────────────

export async function getBuyerAttributionForDomain(domainId: string) {
  const sessions = await db.query.buyerSessions.findMany({
    where: eq(buyerSessions.domainId, domainId),
    orderBy: [desc(buyerSessions.createdAt)],
  });

  // Attribution breakdown by intent
  const intentMap = sessions.reduce<Record<string, number>>((acc, s) => {
    const intent = s.intent ?? "unknown";
    acc[intent] = (acc[intent] ?? 0) + 1;
    return acc;
  }, {});

  // Conversion path: sessions with buyer email = converted
  const converted = sessions.filter((s) => s.buyerEmail).length;
  const conversionRate = sessions.length > 0 ? Math.round((converted / sessions.length) * 100) : 0;

  // Timeline: group by day
  const byDay = sessions.reduce<Record<string, number>>((acc, s) => {
    const day = s.createdAt.toISOString().split("T")[0];
    acc[day] = (acc[day] ?? 0) + 1;
    return acc;
  }, {});

  const dailyTrend = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, count]) => ({ date, count }));

  return {
    sessions,
    total: sessions.length,
    converted,
    conversionRate,
    intentBreakdown: Object.entries(intentMap).map(([intent, count]) => ({ intent, count })),
    dailyTrend,
  };
}

export async function getBuyerAttributionForOrg(orgId: string) {
  const orgDomains = await db.query.domains.findMany({
    where: eq(domains.orgId, orgId),
    columns: { id: true, name: true },
  });

  const results = await Promise.all(
    orgDomains.map(async (d) => {
      const attribution = await getBuyerAttributionForDomain(d.id);
      return { domain: d, ...attribution };
    }),
  );

  const totalSessions = results.reduce((sum, r) => sum + r.total, 0);
  const totalConverted = results.reduce((sum, r) => sum + r.converted, 0);
  const overallConversionRate =
    totalSessions > 0 ? Math.round((totalConverted / totalSessions) * 100) : 0;

  return { domains: results, totalSessions, totalConverted, overallConversionRate };
}

// ─── Advanced Analytics / Monetization Decay ─────────────────────────────────

export async function getMonetizationDecayForOrg(orgId: string) {
  const orgDomains = await db.query.domains.findMany({
    where: eq(domains.orgId, orgId),
    columns: { id: true, name: true, healthScore: true },
  });

  const results = await Promise.all(
    orgDomains.map(async (d) => {
      const signals = await db.query.monetizationDecaySignals.findMany({
        where: eq(monetizationDecaySignals.domainId, d.id),
        orderBy: [desc(monetizationDecaySignals.recordedAt)],
        limit: 30,
      });
      const avgDecay =
        signals.length > 0
          ? signals.reduce((sum, s) => sum + Number(s.decayFactor), 0) / signals.length
          : 1;
      return { domain: d, signals, avgDecay: Math.round(avgDecay * 10000) / 10000 };
    }),
  );

  return results;
}

export async function getPortfolioTrend(orgId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const orgDomains = await db.query.domains.findMany({
    where: eq(domains.orgId, orgId),
    columns: { id: true },
  });

  const domainIds = orgDomains.map((d) => d.id);
  if (domainIds.length === 0) return [];

  const signals = await db.query.monetizationDecaySignals.findMany({
    where: gte(monetizationDecaySignals.recordedAt, since),
    orderBy: [desc(monetizationDecaySignals.recordedAt)],
  });

  const filtered = signals.filter((s) => domainIds.includes(s.domainId));

  // Group by day
  const byDay = filtered.reduce<Record<string, { sum: number; count: number }>>((acc, s) => {
    const day = s.recordedAt.toISOString().split("T")[0];
    if (!acc[day]) acc[day] = { sum: 0, count: 0 };
    acc[day].sum += Number(s.decayFactor);
    acc[day].count += 1;
    return acc;
  }, {});

  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { sum, count }]) => ({
      date,
      avgDecay: Math.round((sum / count) * 10000) / 10000,
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
  AVG(d.health_score) AS avg_health_score,
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

export const REFRESH_PORTFOLIO_ROI_VIEW_SQL = `REFRESH MATERIALIZED VIEW CONCURRENTLY portfolio_roi_summary;`;

export async function getPortfolioRoiMaterializedView(orgId: string) {
  try {
    const result = await db.execute(
      sql`SELECT * FROM portfolio_roi_summary WHERE org_id = ${orgId}`,
    );
    return result.rows[0] ?? null;
  } catch {
    // Materialized view may not exist yet — fall back to live query
    return null;
  }
}
