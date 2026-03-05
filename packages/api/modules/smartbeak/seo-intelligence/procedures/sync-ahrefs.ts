import { ORPCError } from "@orpc/server";
import {
  bulkUpsertKeywords,
  getDomainById,
  updateSeoAhrefsData,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

/**
 * Ahrefs Keywords Explorer adapter.
 *
 * Uses the Ahrefs v3 API: https://docs.ahrefs.com/docs/api3
 * Endpoint: GET /v3/site-explorer/organic-keywords
 *
 * In production: provide a real AHREFS_API_KEY via env.
 * The adapter pattern is identical to the GSC adapter.
 */
async function fetchAhrefsKeywords(
  apiKey: string,
  target: string,
  mode: "domain" | "prefix" | "exact",
  limit: number,
): Promise<
  Array<{
    keyword: string;
    volume: number;
    difficulty: number;
    position: number | null;
    url: string | null;
    cpc: number | null;
  }>
> {
  const params = new URLSearchParams({
    target,
    mode,
    limit: String(limit),
    output: "json",
    token: apiKey,
  });

  const endpoint = `https://apiv2.ahrefs.com/?from=organic_keywords&${params.toString()}`;

  const res = await fetch(endpoint, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new ORPCError("BAD_GATEWAY", {
      message: `Ahrefs API error ${res.status}: ${err}`,
    });
  }

  const data = (await res.json()) as {
    keywords?: Array<{
      keyword: string;
      volume: number;
      difficulty: number;
      pos: number | null;
      url: string | null;
      cpc: number | null;
    }>;
  };

  return (data.keywords ?? []).map((k) => ({
    keyword: k.keyword,
    volume: k.volume,
    difficulty: k.difficulty,
    position: k.pos,
    url: k.url,
    cpc: k.cpc,
  }));
}

export const syncAhrefs = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/seo-intelligence/ahrefs/sync",
    tags: ["SmartBeak - SEO Intelligence"],
    summary: "Sync Ahrefs keyword data for a domain",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      domainId: z.string().uuid(),
      apiKey: z.string().min(1),
      target: z.string().min(1),
      mode: z.enum(["domain", "prefix", "exact"]).default("domain"),
      limit: z.number().int().min(1).max(1000).default(100),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgEditor(org.supastarterOrgId, user.id);

    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }

    let rows: Awaited<ReturnType<typeof fetchAhrefsKeywords>>;
    try {
      rows = await fetchAhrefsKeywords(
        input.apiKey,
        input.target,
        input.mode,
        input.limit,
      );
    } catch (err) {
      throw new ORPCError("BAD_GATEWAY", {
        message: `Ahrefs API error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Persist raw Ahrefs metadata on the SEO document
    const ahrefsData = {
      target: input.target,
      mode: input.mode,
      rowCount: rows.length,
      syncedAt: new Date().toISOString(),
    };
    await updateSeoAhrefsData(input.domainId, ahrefsData);

    // Bulk upsert keywords from Ahrefs
    const keywordRows = rows
      .filter((r) => r.keyword.length > 0)
      .map((r) => ({
        domainId: input.domainId,
        keyword: r.keyword,
        volume: r.volume,
        difficulty: r.difficulty,
        position: r.position ?? undefined,
      }));

    const imported = await bulkUpsertKeywords(keywordRows);

    return {
      keywordsImported: imported.length,
      keywordsTotal: keywordRows.length,
      ahrefsConnected: true,
    };
  });
