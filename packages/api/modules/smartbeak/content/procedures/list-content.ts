import { ORPCError } from "@orpc/server";
import {
  countContentItemsForDomain,
  getDomainById,
  getContentItemsForDomain,
  getOrganizationBySlug,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";

export const listContent = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/content",
    tags: ["SmartBeak - Content"],
    summary: "List content items for a domain",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      domainId: z.string().uuid(),
      status: z.enum(["draft", "published", "scheduled", "archived"]).optional(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgMembership(org.id, user.id);
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
      countContentItemsForDomain(input.domainId, input.status),
    ]);
    return { items, total };
  });
