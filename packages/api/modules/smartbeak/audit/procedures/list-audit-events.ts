import { ORPCError } from "@orpc/server";
import {
  getAuditEventsForOrg,
  getOrganizationBySlug,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgAdmin } from "../../lib/membership";

export const listAuditEvents = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/audit",
    tags: ["SmartBeak - Audit"],
    summary: "List audit events for an organization",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      entityType: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgAdmin(org.id, user.id);
    const events = await getAuditEventsForOrg(org.id, {
      entityType: input.entityType,
      limit: input.limit,
      offset: input.offset,
    });
    return { events };
  });
