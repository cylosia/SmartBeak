import { ORPCError } from "@orpc/server";
import {
	deletePublishTarget,
	getDomainById,
	getPublishTargetById,
	getPublishTargetsForDomain,
	togglePublishTarget,
	upsertPublishTarget,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgAdmin, requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

const PUBLISH_TARGETS = [
	"web",
	"linkedin",
	"facebook",
	"instagram",
	"youtube",
	"wordpress",
	"email",
	"tiktok",
	"pinterest",
	"vimeo",
	"soundcloud",
] as const;

const UNSUPPORTED_TARGET_MESSAGES: Partial<
	Record<(typeof PUBLISH_TARGETS)[number], string>
> = {
	web: "Web publishing targets are not supported yet. Use SmartDeploy directly until the web adapter is implemented.",
	email:
		"Email publishing targets are not supported yet. The current email adapter cannot safely model recipients or per-message content.",
	youtube:
		"YouTube publishing targets are not supported yet. The current publishing queue cannot upload the required video assets.",
	instagram:
		"Instagram publishing targets are not supported yet. The current publishing queue cannot attach the required media assets.",
	tiktok:
		"TikTok publishing targets are not supported yet. The current publishing queue cannot attach the required video assets.",
	vimeo:
		"Vimeo publishing targets are not supported yet. The current publishing queue cannot attach the required video assets.",
};

export const listPlatformTargetsProcedure = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/publishing-suite/targets",
		tags: ["SmartBeak - Publishing Suite"],
		summary: "List all configured platform targets for a domain",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			domainId: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgEditor(org.supastarterOrgId, user.id);
		const domain = await getDomainById(input.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
		}
		const targets = await getPublishTargetsForDomain(input.domainId);
		// Mask encrypted config — only return target name and enabled status
		return {
			targets: targets.map((t) => ({
				id: t.id,
				target: t.target,
				enabled: t.enabled,
				createdAt: t.createdAt,
				configured: true,
			})),
		};
	});

export const upsertPlatformTargetProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/publishing-suite/targets",
		tags: ["SmartBeak - Publishing Suite"],
		summary: "Configure or update a platform publishing target",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			domainId: z.string().uuid(),
			target: z.enum(PUBLISH_TARGETS),
			config: z
				.record(z.string().max(100), z.unknown())
				.refine(
					(v) => JSON.stringify(v).length <= 50_000,
					"Config too large",
				),
			enabled: z.boolean().default(true),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		const domain = await getDomainById(input.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
		}
		const unsupportedMessage = UNSUPPORTED_TARGET_MESSAGES[input.target];
		if (unsupportedMessage) {
			throw new ORPCError("PRECONDITION_FAILED", {
				message: unsupportedMessage,
			});
		}
		const { encrypt } = await import("@repo/utils");
		const configSecret = process.env.SMARTBEAK_ENCRYPTION_KEY;
		if (!configSecret) {
			throw new ORPCError("PRECONDITION_FAILED", {
				message: "SMARTBEAK_ENCRYPTION_KEY is not configured.",
			});
		}
		const encryptedConfig = await encrypt(
			JSON.stringify(input.config),
			configSecret,
		);
		const [target] = await upsertPublishTarget({
			domainId: input.domainId,
			target: input.target,
			encryptedConfig,
			enabled: input.enabled,
		});
		if (!target) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "Failed to configure publishing target.",
			});
		}
		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "publishing.target_configured",
			entityType: "publish_target",
			entityId: target.id,
			details: { target: input.target },
		});
		return {
			target: {
				id: target.id,
				target: input.target,
				enabled: input.enabled,
			},
		};
	});

export const togglePlatformTargetProcedure = protectedProcedure
	.route({
		method: "PATCH",
		path: "/smartbeak/publishing-suite/targets/:targetId/toggle",
		tags: ["SmartBeak - Publishing Suite"],
		summary: "Enable or disable a platform publishing target",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			targetId: z.string().uuid(),
			enabled: z.boolean(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		const target = await getPublishTargetById(input.targetId);
		if (!target) {
			throw new ORPCError("NOT_FOUND", {
				message: "Publishing target not found.",
			});
		}
		const domain = await getDomainById(target.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", {
				message: "Publishing target not found.",
			});
		}
		const [updated] = await togglePublishTarget(
			input.targetId,
			input.enabled,
		);
		if (!updated) {
			throw new ORPCError("NOT_FOUND", {
				message: "Publishing target not found.",
			});
		}
		await audit({
			orgId: org.id,
			actorId: user.id,
			action: input.enabled
				? "publishing.target_enabled"
				: "publishing.target_disabled",
			entityType: "publish_target",
			entityId: input.targetId,
			details: {},
		});
		return {
			updated: {
				id: updated.id,
				target: updated.target,
				enabled: updated.enabled,
			},
		};
	});

export const deletePlatformTargetProcedure = protectedProcedure
	.route({
		method: "DELETE",
		path: "/smartbeak/publishing-suite/targets/:targetId",
		tags: ["SmartBeak - Publishing Suite"],
		summary: "Delete a platform publishing target",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			targetId: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		const target = await getPublishTargetById(input.targetId);
		if (!target) {
			throw new ORPCError("NOT_FOUND", {
				message: "Publishing target not found.",
			});
		}
		const domain = await getDomainById(target.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", {
				message: "Publishing target not found.",
			});
		}
		await deletePublishTarget(input.targetId);
		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "publishing.target_deleted",
			entityType: "publish_target",
			entityId: input.targetId,
			details: {},
		});
		return { deleted: true };
	});
