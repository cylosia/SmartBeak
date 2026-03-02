import { ORPCError } from "@orpc/server";
import {
  countDomainsForOrg,
  getDomainsForOrg,
  getOrganizationBySlug,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";

export const listDomains = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/domains",
    tags: ["SmartBeak - Domains"],
    summary: "List domains for an organization",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgMembership(org.id, user.id);
    const [items, total] = await Promise.all([
      getDomainsForOrg(org.id, {
        query: input.query,
        limit: input.limit,
        offset: input.offset,
      }),
      countDomainsForOrg(org.id),
    ]);
    return { items, total };
  });
