import { ORPCError } from "@orpc/server";
import { getDomainById, updateDomain } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";
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
      organizationSlug: z.string().min(1),
      id: z.string().uuid(),
      name: z.string().min(1).max(255).optional(),
      status: z.enum(["active", "pending", "suspended", "deployed"]).optional(),
      themeId: z.string().optional(),
      deployedUrl: z.string().url().refine(
        (v) => v.startsWith("https://") || v.startsWith("http://"),
        { message: "URL must use http or https" },
      ).nullable().optional(),
      registryData: z.record(z.unknown()).nullable().optional(),
      health: z.record(z.unknown()).nullable().optional(),
      lifecycle: z.record(z.unknown()).nullable().optional(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgAdmin(org.supastarterOrgId, user.id);
    const existing = await getDomainById(input.id);
    if (!existing || existing.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }
    const { organizationSlug, id, ...updateData } = input;
    const [domain] = await updateDomain(id, updateData);
    if (!domain) {
      throw new ORPCError("CONFLICT", { message: "Domain was modified or deleted." });
    }
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
