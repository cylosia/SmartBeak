import { ORPCError } from "@orpc/server";
import {
  getContentItemById,
  getContentRevisions,
  getDomainById,
  getOrganizationBySlug,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";

export const getContentItem = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/content/{id}",
    tags: ["SmartBeak - Content"],
    summary: "Get a content item with its revisions",
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
    await requireOrgMembership(org.id, user.id);
    const item = await getContentItemById(input.id);
    if (!item) throw new ORPCError("NOT_FOUND", { message: "Content item not found." });
    const domain = await getDomainById(item.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("FORBIDDEN");
    }
    const revisions = await getContentRevisions(input.id);
    return { item, revisions };
  });
