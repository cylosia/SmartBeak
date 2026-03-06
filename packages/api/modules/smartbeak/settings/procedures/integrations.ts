import {
  createIntegration,
  deleteIntegration as dbDeleteIntegration,
  getIntegrationByProvider,
  getIntegrationsForOrg,
  updateIntegration,
} from "@repo/database";
import { encrypt, decrypt } from "@repo/utils";
import { ORPCError } from "@orpc/server";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgAdmin } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

const ENCRYPTION_SECRET = process.env.SMARTBEAK_ENCRYPTION_KEY;
if (!ENCRYPTION_SECRET) {
  throw new Error("SMARTBEAK_ENCRYPTION_KEY is required for encryption");
}

const SUPPORTED_PROVIDERS = ["openai", "google_search_console", "ahrefs"] as const;

export const listIntegrations = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/settings/integrations",
    tags: ["SmartBeak - Settings"],
    summary: "List all integrations for an organization",
  })
  .input(z.object({ organizationSlug: z.string().min(1) }))
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgAdmin(org.supastarterOrgId, user.id);

    const integrations = await getIntegrationsForOrg(org.id);

    return {
      integrations: integrations.map((i) => ({
        id: i.id,
        provider: i.provider,
        enabled: i.enabled,
        hasKey: i.encryptedConfig != null && i.encryptedConfig.length > 0,
        createdAt: i.createdAt,
      })),
    };
  });

export const upsertIntegration = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/settings/integrations",
    tags: ["SmartBeak - Settings"],
    summary: "Create or update an integration",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      provider: z.enum(SUPPORTED_PROVIDERS),
      config: z.object({
        apiKey: z.string().min(1),
        siteUrl: z.string().url().optional(),
      }),
      enabled: z.boolean().default(true),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgAdmin(org.supastarterOrgId, user.id);

    const configJson = JSON.stringify(input.config);
    const encryptedConfig = encrypt(configJson, ENCRYPTION_SECRET);

    const existing = await getIntegrationByProvider(org.id, input.provider);

    if (existing) {
      const [updated] = await updateIntegration(existing.id, {
        encryptedConfig,
        enabled: input.enabled,
      });
      return {
        integration: {
          id: updated.id,
          provider: updated.provider,
          enabled: updated.enabled,
          hasKey: true,
        },
      };
    }

    const [created] = await createIntegration({
      orgId: org.id,
      provider: input.provider,
      encryptedConfig,
      enabled: input.enabled,
    });

    return {
      integration: {
        id: created.id,
        provider: created.provider,
        enabled: created.enabled,
        hasKey: true,
      },
    };
  });

export const removeIntegration = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/settings/integrations/delete",
    tags: ["SmartBeak - Settings"],
    summary: "Delete an integration",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      provider: z.enum(SUPPORTED_PROVIDERS),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgAdmin(org.supastarterOrgId, user.id);

    const existing = await getIntegrationByProvider(org.id, input.provider);
    if (!existing) {
      throw new ORPCError("NOT_FOUND", {
        message: "Integration not found.",
      });
    }

    await dbDeleteIntegration(existing.id);
    return { success: true };
  });

export const testIntegration = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/settings/integrations/test",
    tags: ["SmartBeak - Settings"],
    summary: "Test an integration connection",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      provider: z.enum(SUPPORTED_PROVIDERS),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgAdmin(org.supastarterOrgId, user.id);

    const integration = await getIntegrationByProvider(org.id, input.provider);
    if (!integration) {
      throw new ORPCError("NOT_FOUND", {
        message: "Integration not found. Save a key first.",
      });
    }

    let config: { apiKey: string; siteUrl?: string };
    try {
      const configJson = decrypt(integration.encryptedConfig, ENCRYPTION_SECRET);
      config = JSON.parse(configJson) as { apiKey: string; siteUrl?: string };
    } catch {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to decrypt integration config." });
    }

    if (input.provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      if (!res.ok) {
        throw new ORPCError("BAD_REQUEST", {
          message: `OpenAI API key test failed (${res.status}). Please verify your API key.`,
        });
      }
      return { success: true, message: "OpenAI connection successful." };
    }

    if (input.provider === "google_search_console") {
      return { success: true, message: "GSC key saved. Live verification coming soon." };
    }

    if (input.provider === "ahrefs") {
      return { success: true, message: "Ahrefs key saved. Live verification coming soon." };
    }

    return { success: true, message: "Key saved." };
  });

export const integrationsRouter = {
  list: listIntegrations,
  upsert: upsertIntegration,
  delete: removeIntegration,
  test: testIntegration,
};
