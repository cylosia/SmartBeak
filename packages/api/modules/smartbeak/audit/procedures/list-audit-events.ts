import { countAuditEventsForOrg, getAuditEventsForOrg } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgAdmin } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const listAuditEvents = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/audit",
    tags: ["SmartBeak - Audit"],
    summary: "List audit events for an organization",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      entityType: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgAdmin(org.supastarterOrgId, user.id);
    const [items, total] = await Promise.all([
      getAuditEventsForOrg(org.id, {
        entityType: input.entityType,
        limit: input.limit,
        offset: input.offset,
      }),
      countAuditEventsForOrg(org.id, { entityType: input.entityType }),
    ]);
    return { items, total };
  });
