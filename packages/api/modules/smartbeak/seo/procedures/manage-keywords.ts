import { ORPCError } from "@orpc/server";
import {
  deleteKeyword,
  getDomainById,
  getKeywordById,
  upsertKeyword,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const addKeyword = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/seo/keywords",
    tags: ["SmartBeak - SEO"],
    summary: "Add a keyword to track for a domain",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      domainId: z.string().uuid(),
      keyword: z.string().min(1).max(255),
      volume: z.number().int().min(0).optional(),
      difficulty: z.number().int().min(0).max(100).optional(),
      position: z.number().int().min(0).optional(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgEditor(org.supastarterOrgId, user.id);
    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }
    const [keyword] = await upsertKeyword({
      domainId: input.domainId,
      keyword: input.keyword,
      volume: input.volume,
      difficulty: input.difficulty,
      position: input.position,
    });
    return { keyword };
  });

export const removeKeyword = protectedProcedure
  .route({
    method: "DELETE",
    path: "/smartbeak/seo/keywords/{id}",
    tags: ["SmartBeak - SEO"],
    summary: "Remove a tracked keyword",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      id: z.string().uuid(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgEditor(org.supastarterOrgId, user.id);
    const keyword = await getKeywordById(input.id);
    if (!keyword) throw new ORPCError("NOT_FOUND", { message: "Keyword not found." });
    const domain = await getDomainById(keyword.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("FORBIDDEN", { message: "Access denied." });
    }
    await deleteKeyword(input.id);
    await audit({
      orgId: org.id,
      actorId: user.id,
      action: "keyword.deleted",
      entityType: "keyword_tracking",
      entityId: input.id,
      details: { keyword: keyword.keyword, domainId: keyword.domainId },
    });
    return { success: true };
  });
