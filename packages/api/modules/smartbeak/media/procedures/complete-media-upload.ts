import { ORPCError } from "@orpc/server";
import {
	getDomainById,
	getMediaAssetById,
	updateMediaAsset,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const completeMediaUploadProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/media/{id}/complete",
		tags: ["SmartBeak - Media"],
		summary: "Finalize a completed media upload",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			id: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgEditor(org.supastarterOrgId, user.id);

		const asset = await getMediaAssetById(input.id);
		if (!asset) {
			throw new ORPCError("NOT_FOUND", {
				message: "Media asset not found.",
			});
		}

		const domain = await getDomainById(asset.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("FORBIDDEN", { message: "Access denied." });
		}

		const lifecycle = {
			...((asset.lifecycle as Record<string, unknown> | null) ?? {}),
			uploadStatus: "uploaded",
			uploadedAt: new Date().toISOString(),
		};

		await updateMediaAsset(input.id, { lifecycle });
		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "media.upload_completed",
			entityType: "media_asset",
			entityId: input.id,
			details: { fileName: asset.fileName },
		});

		return { success: true };
	});
