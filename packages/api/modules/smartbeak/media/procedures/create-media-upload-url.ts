import { ORPCError } from "@orpc/server";
import { createMediaAsset, getDomainById } from "@repo/database";
import { getSignedUploadUrl } from "@repo/storage";
import { getBaseUrl } from "@repo/utils";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const createMediaUploadUrl = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/media/upload-url",
    tags: ["SmartBeak - Media"],
    summary: "Get a signed upload URL for a media asset",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1).max(255),
      domainId: z.string().uuid(),
      fileName: z.string().min(1).max(500),
      type: z.string().min(1).max(100).regex(/^[a-z]+\/[a-z0-9.+-]+$/i, "Invalid MIME type"),
      size: z.number().int().positive().max(100 * 1024 * 1024).optional(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgEditor(org.supastarterOrgId, user.id);
    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }
    const safeFileName = input.fileName.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
    const path = `${org.id}/${input.domainId}/${Date.now()}-${safeFileName}`;
    const signedUploadUrl = await getSignedUploadUrl(path, {
      bucket: "avatars", // reuse existing bucket; production would use a dedicated media bucket
    });
    // Pre-register the asset so the client can reference it immediately
    const publicUrl = `${getBaseUrl()}/api/media/${path}`;
    const [asset] = await createMediaAsset({
      domainId: input.domainId,
      fileName: input.fileName,
      url: publicUrl,
      type: input.type,
      size: input.size,
    });
    await audit({
      orgId: org.id,
      actorId: user.id,
      action: "media.created",
      entityType: "media_asset",
      entityId: asset?.id,
      details: { fileName: input.fileName, type: input.type },
    });
    return { signedUploadUrl, path, asset };
  });
