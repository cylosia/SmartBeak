import { ORPCError } from "@orpc/server";
import { createDomain, getOrganizationBySlug } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgAdmin } from "../../lib/membership";

export const createDomainProcedure = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/domains",
    tags: ["SmartBeak - Domains"],
    summary: "Create a new domain",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      name: z.string().min(1).max(255),
      slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
      themeId: z.string().optional(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgAdmin(org.id, user.id);
    const [domain] = await createDomain({
      orgId: org.id,
      name: input.name,
      slug: input.slug,
      themeId: input.themeId,
    });
    await audit({
      orgId: org.id,
      actorId: user.id,
      action: "domain.created",
      entityType: "domain",
      entityId: domain?.id,
      details: { name: input.name, slug: input.slug },
    });
    return { domain };
  });
