import { ORPCError } from "@orpc/server";
import {
  getFeatureFlagsForOrg,
  getGuardrailsForOrg,
  getOrganizationBySlug,
  upsertFeatureFlag,
  upsertGuardrail,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgAdmin } from "../../lib/membership";

export const getOrgSettings = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/settings",
    tags: ["SmartBeak - Settings"],
    summary: "Get feature flags and guardrails for an organization",
  })
  .input(z.object({ organizationSlug: z.string() }))
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgAdmin(org.id, user.id);
    const [featureFlags, guardrails] = await Promise.all([
      getFeatureFlagsForOrg(org.id),
      getGuardrailsForOrg(org.id),
    ]);
    return { featureFlags, guardrails };
  });

export const upsertFlag = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/settings/flags",
    tags: ["SmartBeak - Settings"],
    summary: "Upsert a feature flag",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      key: z.string().min(1).max(100),
      enabled: z.boolean().optional(),
      config: z.record(z.unknown()).optional(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgAdmin(org.id, user.id);
    const [flag] = await upsertFeatureFlag({
      orgId: org.id,
      key: input.key,
      enabled: input.enabled,
      config: input.config,
    });
    return { flag };
  });

export const upsertGuardrailProcedure = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/settings/guardrails",
    tags: ["SmartBeak - Settings"],
    summary: "Upsert a guardrail rule",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      rule: z.string().min(1).max(100),
      value: z.number().int(),
      enabled: z.boolean().optional(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgAdmin(org.id, user.id);
    const [guardrail] = await upsertGuardrail({
      orgId: org.id,
      rule: input.rule,
      value: input.value,
      enabled: input.enabled,
    });
    return { guardrail };
  });
