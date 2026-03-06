import { ORPCError } from "@orpc/server";
import { createDomain } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";
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
      organizationSlug: z.string().min(1),
      name: z.string().min(1).max(255),
      slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
      themeId: z.string().min(1).optional(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgAdmin(org.supastarterOrgId, user.id);

    let domain;
    try {
      [domain] = await createDomain({
        orgId: org.id,
        name: input.name,
        slug: input.slug,
        themeId: input.themeId,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("unique")) {
        throw new ORPCError("CONFLICT", { message: "A domain with this slug already exists." });
      }
      throw err;
    }

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
