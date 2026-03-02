import { ORPCError } from "@orpc/server";
import {
  getDomainById,
  getContentItemById,
  getOrganizationBySlug,
  softDeleteContentItem,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";

export const deleteContentItemProcedure = protectedProcedure
  .route({
    method: "DELETE",
    path: "/smartbeak/content/{id}",
    tags: ["SmartBeak - Content"],
    summary: "Soft-delete a content item",
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
    await requireOrgEditor(org.id, user.id);
    const existing = await getContentItemById(input.id);
    if (!existing) throw new ORPCError("NOT_FOUND", { message: "Content item not found." });
    const domain = await getDomainById(existing.domainId);
    if (!domain || domain.orgId !== org.id) throw new ORPCError("FORBIDDEN");
    await softDeleteContentItem(input.id);
    await audit({
      orgId: org.id,
      actorId: user.id,
      action: "content.deleted",
      entityType: "content_item",
      entityId: input.id,
      details: { title: existing.title },
    });
    return { success: true };
  });
