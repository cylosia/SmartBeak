import { ORPCError } from "@orpc/server";
import { deleteDomain, getDomainById } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";
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
      organizationSlug: z.string().min(1),
      id: z.string().uuid(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgAdmin(org.supastarterOrgId, user.id);
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
