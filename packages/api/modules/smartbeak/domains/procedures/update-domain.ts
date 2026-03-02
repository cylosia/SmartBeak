import { ORPCError } from "@orpc/server";
import { getDomainById, getOrganizationBySlug, updateDomain } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgAdmin } from "../../lib/membership";

export const updateDomainProcedure = protectedProcedure
  .route({
    method: "PATCH",
    path: "/smartbeak/domains/{id}",
    tags: ["SmartBeak - Domains"],
    summary: "Update a domain",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      id: z.string().uuid(),
      name: z.string().min(1).max(255).optional(),
      status: z.enum(["active", "pending", "suspended", "deployed"]).optional(),
      themeId: z.string().optional(),
      deployedUrl: z.string().url().nullable().optional(),
      registryData: z.record(z.unknown()).nullable().optional(),
      health: z.record(z.unknown()).nullable().optional(),
      lifecycle: z.record(z.unknown()).nullable().optional(),
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
    const { organizationSlug, id, ...updateData } = input;
    const [domain] = await updateDomain(id, updateData);
    await audit({
      orgId: org.id,
      actorId: user.id,
      action: "domain.updated",
      entityType: "domain",
      entityId: id,
      details: updateData as Record<string, unknown>,
    });
    return { domain };
  });
