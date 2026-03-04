import { ORPCError } from "@orpc/server";
import {
  deleteMediaAsset,
  getDomainById,
  getMediaAssetById,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const deleteMediaProcedure = protectedProcedure
  .route({
    method: "DELETE",
    path: "/smartbeak/media/{id}",
    tags: ["SmartBeak - Media"],
    summary: "Delete a media asset",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      id: z.string().uuid(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgEditor(org.supastarterOrgId, user.id);
    const asset = await getMediaAssetById(input.id);
    if (!asset) throw new ORPCError("NOT_FOUND", { message: "Media asset not found." });
    const domain = await getDomainById(asset.domainId);
    if (!domain || domain.orgId !== org.id) throw new ORPCError("FORBIDDEN", { message: "Access denied." });
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
