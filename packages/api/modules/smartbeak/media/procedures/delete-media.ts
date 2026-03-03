import { ORPCError } from "@orpc/server";
import {
  deleteMediaAsset,
  getDomainById,
  getMediaAssetById,
  getOrganizationBySlug,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";

export const deleteMediaProcedure = protectedProcedure
  .route({
    method: "DELETE",
    path: "/smartbeak/media/{id}",
    tags: ["SmartBeak - Media"],
    summary: "Delete a media asset",
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
    const asset = await getMediaAssetById(input.id);
    if (!asset) throw new ORPCError("NOT_FOUND", { message: "Media asset not found." });
    const domain = await getDomainById(asset.domainId);
    if (!domain || domain.orgId !== org.id) throw new ORPCError("FORBIDDEN");
    await deleteMediaAsset(input.id);
    await audit({
      orgId: org.id,
      actorId: user.id,
      action: "media.deleted",
      entityType: "media_asset",
      entityId: input.id,
      details: { fileName: asset.fileName },
    });
    return { success: true };
  });
