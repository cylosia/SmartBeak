import { ORPCError } from "@orpc/server";
import {
	createIntegration,
	deleteIntegration as dbDeleteIntegration,
	getIntegrationByProvider,
	getIntegrationsForOrg,
	updateIntegration,
} from "@repo/database";
import { decrypt, encrypt } from "@repo/utils";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgAdmin } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

function getEncryptionSecret(): string {
	const secret = process.env.SMARTBEAK_ENCRYPTION_KEY;
	if (!secret) {
		throw new ORPCError("PRECONDITION_FAILED", {
			message:
				"Encryption key not configured. Contact your administrator.",
		});
	}
	return secret;
}

const SUPPORTED_PROVIDERS = [
	"openai",
	"google_search_console",
	"ahrefs",
] as const;

const LIVE_TESTABLE_PROVIDERS = ["openai"] as const;

function supportsLiveCredentialTest(
	provider: (typeof SUPPORTED_PROVIDERS)[number],
): provider is (typeof LIVE_TESTABLE_PROVIDERS)[number] {
	return (LIVE_TESTABLE_PROVIDERS as readonly string[]).includes(provider);
}

export const listIntegrations = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/settings/integrations",
		tags: ["SmartBeak - Settings"],
		summary: "List stored provider credentials for an organization",
	})
	.input(z.object({ organizationSlug: z.string().min(1) }))
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);

		const integrations = await getIntegrationsForOrg(org.id);

		return {
			encryptionConfigured: Boolean(process.env.SMARTBEAK_ENCRYPTION_KEY),
			integrations: integrations.map((i) => ({
				id: i.id,
				provider: i.provider,
				enabled: i.enabled,
				hasKey:
					i.encryptedConfig != null && i.encryptedConfig.length > 0,
				createdAt: i.createdAt,
			})),
		};
	});

export const upsertIntegration = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/settings/integrations",
		tags: ["SmartBeak - Settings"],
		summary: "Create or update a stored provider credential",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			provider: z.enum(SUPPORTED_PROVIDERS),
			config: z.object({
				apiKey: z.string().min(1).max(2048),
				siteUrl: z.string().url().optional(),
			}),
			enabled: z.boolean().default(true),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);

		const configJson = JSON.stringify(input.config);
		const encryptedConfig = await encrypt(
			configJson,
			getEncryptionSecret(),
		);

		const existing = await getIntegrationByProvider(org.id, input.provider);

		if (existing) {
			const [updated] = await updateIntegration(existing.id, {
				encryptedConfig,
				enabled: input.enabled,
			});
			if (!updated) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to update integration.",
				});
			}
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
		if (!created) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "Failed to create integration.",
			});
		}

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
		summary: "Delete a stored provider credential",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
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

		const [deleted] = await dbDeleteIntegration(existing.id);
		if (!deleted) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "Failed to delete integration.",
			});
		}
		return { success: true };
	});

export const testIntegration = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/settings/integrations/test",
		tags: ["SmartBeak - Settings"],
		summary: "Test a stored provider credential when live verification is supported",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			provider: z.enum(SUPPORTED_PROVIDERS),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);

		const integration = await getIntegrationByProvider(
			org.id,
			input.provider,
		);
		if (!integration) {
			throw new ORPCError("NOT_FOUND", {
				message: "Integration not found. Save a key first.",
			});
		}

		let config: { apiKey: string; siteUrl?: string };
		try {
			const configJson = await decrypt(
				integration.encryptedConfig,
				getEncryptionSecret(),
			);
			config = JSON.parse(configJson) as {
				apiKey: string;
				siteUrl?: string;
			};
		} catch {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "Failed to decrypt integration config.",
			});
		}
		if (
			typeof config.apiKey !== "string" ||
			config.apiKey.trim().length === 0
		) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "Integration config is missing a valid API key.",
			});
		}

		if (!supportsLiveCredentialTest(input.provider)) {
			throw new ORPCError("PRECONDITION_FAILED", {
				message: `${input.provider === "google_search_console" ? "Google Search Console" : "Ahrefs"} credential verification is not implemented yet. The key may be saved, but this test cannot validate it.`,
			});
		}

		if (input.provider === "openai") {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 15_000);
			try {
				const res = await fetch("https://api.openai.com/v1/models", {
					headers: { Authorization: `Bearer ${config.apiKey}` },
					signal: controller.signal,
				});
				if (!res.ok) {
					throw new ORPCError("BAD_REQUEST", {
						message: `OpenAI API key test failed (${res.status}). Please verify your API key.`,
					});
				}
				return {
					success: true,
					message: "OpenAI connection successful.",
				};
			} finally {
				clearTimeout(timeout);
			}
		}

		return { success: true, message: "Key saved." };
	});

export const integrationsRouter = {
	list: listIntegrations,
	upsert: upsertIntegration,
	delete: removeIntegration,
	test: testIntegration,
};
