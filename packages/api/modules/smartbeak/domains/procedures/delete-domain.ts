import { ORPCError } from "@orpc/server";
import { deleteDomain, getDomainById, getOrganizationBySlug } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgAdmin } from "../../lib/membership";

export const deleteDomainProcedure = protectedProcedure
  .route({
    method: "DELETE",
    path: "/smartbeak/domains/{id}",
    tags: ["SmartBeak - Domains"],
    summary: "Delete a domain",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      id: z.string().uuid(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgAdmin(org.id, user.id);
    const existing = await getDomainById(input.id);
    if (!existing || existing.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }
    await deleteDomain(input.id);
    await audit({
      orgId: org.id,
      actorId: user.id,
      action: "domain.deleted",
      entityType: "domain",
      entityId: input.id,
      details: { name: existing.name },
    });
    return { success: true };
  });
