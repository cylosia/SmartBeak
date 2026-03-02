import { ORPCError } from "@orpc/server";
import { getDomainById, getOrganizationBySlug } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";

export const getDomain = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/domains/{id}",
    tags: ["SmartBeak - Domains"],
    summary: "Get a domain by ID",
  })
  .input(
    z.object({
      id: z.string().uuid(),
      organizationSlug: z.string(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgMembership(org.id, user.id);
    const domain = await getDomainById(input.id);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }
    return { domain };
  });
