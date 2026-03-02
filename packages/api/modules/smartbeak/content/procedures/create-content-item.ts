import { ORPCError } from "@orpc/server";
import {
  createContentItem,
  getDomainById,
  getOrganizationBySlug,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";

export const createContentItemProcedure = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/content",
    tags: ["SmartBeak - Content"],
    summary: "Create a new content item",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      domainId: z.string().uuid(),
      title: z.string().min(1).max(500),
      body: z.string().optional(),
      status: z.enum(["draft", "published", "scheduled", "archived"]).optional(),
      scheduledFor: z.string().datetime().nullable().optional(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgEditor(org.id, user.id);
    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }
    const [item] = await createContentItem({
      domainId: input.domainId,
      title: input.title,
      body: input.body,
      status: input.status ?? "draft",
      createdBy: user.id,
    });
    await audit({
      orgId: org.id,
      actorId: user.id,
      action: "content.created",
      entityType: "content_item",
      entityId: item?.id,
      details: { title: input.title, domainId: input.domainId },
    });
    return { item };
  });
