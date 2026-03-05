import { ORPCError } from "@orpc/server";
import {
  deletePublishTarget,
  getDomainById,
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
  "web", "linkedin", "facebook", "instagram", "youtube",
  "wordpress", "email", "tiktok", "pinterest", "vimeo", "soundcloud",
] as const;

export const listPlatformTargetsProcedure = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/publishing-suite/targets",
    tags: ["SmartBeak - Publishing Suite"],
    summary: "List all configured platform targets for a domain",
  })
  .input(z.object({ organizationSlug: z.string().min(1), domainId: z.string().uuid() }))
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
      organizationSlug: z.string().min(1),
      domainId: z.string().uuid(),
      target: z.enum(PUBLISH_TARGETS),
      config: z.record(z.unknown()),
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
    // Encrypt config as JSON buffer (real impl: AES-256-GCM with KMS key)
    const encryptedConfig = Buffer.from(JSON.stringify(input.config), "utf8");
    const [target] = await upsertPublishTarget({
      domainId: input.domainId,
      target: input.target,
      encryptedConfig,
      enabled: input.enabled,
    });
    await audit({
      orgId: org.id,
      actorId: user.id,
      action: "publishing.target_configured",
      entityType: "publish_target",
      entityId: target?.id,
      details: { target: input.target },
    });
    return { target: { id: target?.id, target: input.target, enabled: input.enabled } };
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
      organizationSlug: z.string().min(1),
      targetId: z.string().uuid(),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgAdmin(org.supastarterOrgId, user.id);
    const [updated] = await togglePublishTarget(input.targetId, input.enabled);
    await audit({
      orgId: org.id,
      actorId: user.id,
      action: input.enabled ? "publishing.target_enabled" : "publishing.target_disabled",
      entityType: "publish_target",
      entityId: input.targetId,
      details: {},
    });
    return { updated };
  });

export const deletePlatformTargetProcedure = protectedProcedure
  .route({
    method: "DELETE",
    path: "/smartbeak/publishing-suite/targets/:targetId",
    tags: ["SmartBeak - Publishing Suite"],
    summary: "Delete a platform publishing target",
  })
  .input(z.object({ organizationSlug: z.string().min(1), targetId: z.string().uuid() }))
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgAdmin(org.supastarterOrgId, user.id);
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
