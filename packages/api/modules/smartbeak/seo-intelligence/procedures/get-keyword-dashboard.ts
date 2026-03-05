import { ORPCError } from "@orpc/server";
import {
  getDomainById,
  getKeywordClusters,
  getKeywordsByDomain,
  getSeoDashboardSummary,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getKeywordDashboard = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/seo-intelligence/dashboard",
    tags: ["SmartBeak - SEO Intelligence"],
    summary: "Get full SEO keyword dashboard: summary, keywords, and clusters",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      domainId: z.string().uuid(),
      minVolume: z.number().int().min(0).optional(),
      maxDifficulty: z.number().int().min(0).max(100).optional(),
      hasPosition: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);

    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }

    const [summary, keywords, clusters] = await Promise.all([
      getSeoDashboardSummary(input.domainId),
      getKeywordsByDomain(input.domainId, {
        minVolume: input.minVolume,
        maxDifficulty: input.maxDifficulty,
        hasPosition: input.hasPosition,
        limit: input.limit,
        offset: input.offset,
      }),
      getKeywordClusters(input.domainId),
    ]);

    return { summary, keywords, clusters };
  });
