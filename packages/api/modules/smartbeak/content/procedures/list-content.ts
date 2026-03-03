import { ORPCError } from "@orpc/server";
import {
  countContentItemsForDomain,
  getDomainById,
  getContentItemsForDomain,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const listContent = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/content",
    tags: ["SmartBeak - Content"],
    summary: "List content items for a domain",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      domainId: z.string().uuid(),
      status: z.enum(["draft", "published", "scheduled", "archived"]).optional(),
      query: z.string().max(255).optional(),
      limit: z.number().int().min(1).max(100).default(50),
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
    const [items, total] = await Promise.all([
      getContentItemsForDomain(input.domainId, {
        status: input.status,
        query: input.query,
        limit: input.limit,
        offset: input.offset,
      }),
      countContentItemsForDomain(input.domainId, {
        status: input.status,
        query: input.query,
      }),
    ]);
    return { items, total };
  });
