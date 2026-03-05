import { ORPCError } from "@orpc/server";
import {
  bulkUpsertKeywords,
  getDomainById,
  updateSeoGscData,
  updateSeoScore,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

/**
 * Google Search Console adapter.
 *
 * In production: call the real GSC API using the provided accessToken.
 * The adapter pattern is identical to the Ahrefs adapter — swap the fetch
 * target to integrate any third-party SEO data source.
 *
 * GSC API reference: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 */
async function fetchGscData(
  siteUrl: string,
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<
  Array<{
    keyword: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>
> {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

  const body = {
    startDate,
    endDate,
    dimensions: ["query"],
    rowLimit: 1000,
    startRow: 0,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new ORPCError("BAD_GATEWAY", {
      message: `GSC API error ${res.status}: ${err}`,
    });
  }

  const data = (await res.json()) as {
    rows?: Array<{
      keys: string[];
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
    }>;
  };

  return (data.rows ?? []).map((row) => ({
    keyword: row.keys[0] ?? "",
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: Math.round(row.position),
  }));
}

/**
 * Compute a simple SEO score from GSC data:
 * - Average position (lower is better, max 40 pts)
 * - CTR (higher is better, max 30 pts)
 * - Impression volume (max 30 pts)
 */
function computeSeoScore(
  rows: Array<{ position: number; ctr: number; impressions: number }>,
): number {
  if (rows.length === 0) return 0;
  const avgPos =
    rows.reduce((s, r) => s + r.position, 0) / rows.length;
  const avgCtr =
    rows.reduce((s, r) => s + r.ctr, 0) / rows.length;
  const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);

  const posScore = Math.max(0, 40 - avgPos * 2);
  const ctrScore = Math.min(30, avgCtr * 1000);
  const impScore = Math.min(30, Math.log10(totalImpressions + 1) * 10);

  return Math.round(posScore + ctrScore + impScore);
}

export const syncGsc = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/seo-intelligence/gsc/sync",
    tags: ["SmartBeak - SEO Intelligence"],
    summary: "Sync Google Search Console data for a domain",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      domainId: z.string().uuid(),
      siteUrl: z.string().url(),
      accessToken: z.string().min(1),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgEditor(org.supastarterOrgId, user.id);

    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }

    let rows: Awaited<ReturnType<typeof fetchGscData>>;
    try {
      rows = await fetchGscData(
        input.siteUrl,
        input.accessToken,
        input.startDate,
        input.endDate,
      );
    } catch (err) {
      throw new ORPCError("BAD_GATEWAY", {
        message: `GSC API error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Persist raw GSC data on the SEO document
    const gscData = {
      siteUrl: input.siteUrl,
      startDate: input.startDate,
      endDate: input.endDate,
      rowCount: rows.length,
      syncedAt: new Date().toISOString(),
    };
    await updateSeoGscData(input.domainId, gscData);

    // Bulk upsert keywords from GSC
    const keywordRows = rows
      .filter((r) => r.keyword.length > 0)
      .map((r) => ({
        domainId: input.domainId,
        keyword: r.keyword,
        position: r.position,
        volume: r.impressions,
      }));

    const imported = await bulkUpsertKeywords(keywordRows);

    // Compute and persist SEO score
    const score = computeSeoScore(rows);
    await updateSeoScore(input.domainId, score, {
      gscRowCount: rows.length,
      avgPosition:
        rows.reduce((s, r) => s + r.position, 0) / (rows.length || 1),
      avgCtr: rows.reduce((s, r) => s + r.ctr, 0) / (rows.length || 1),
    });

    return {
      keywordsImported: imported.length,
      keywordsUpdated: keywordRows.length - imported.length,
      seoScoreUpdated: true,
      newScore: score,
    };
  });
