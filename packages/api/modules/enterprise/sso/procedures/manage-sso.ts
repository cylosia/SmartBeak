/**
 * Enterprise SSO — SAML/OIDC provider management procedures.
 *
 * All SSO configuration data (IdP metadata, client secrets) is encrypted
 * at rest using AES-256-GCM before being stored in the database.
 * Decrypted config is NEVER returned to the client — only non-sensitive
 * display metadata is exposed.
 */

import { ORPCError } from "@orpc/server";
import {
	deleteSsoProvider,
	getSsoProviderById,
	getSsoProvidersForOrg,
	updateSsoProviderStatus,
	upsertSsoProvider,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { encryptConfig } from "../../lib/crypto";
import { requireEnterpriseFeature } from "../../lib/feature-gate";
import { requireOrgAdmin } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const listSsoProviders = protectedProcedure
	.route({
		method: "GET",
		path: "/enterprise/sso",
		tags: ["Enterprise - SSO"],
		summary: "List saved SSO provider settings for an organization",
	})
	.input(z.object({ organizationSlug: z.string().min(1) }))
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "sso");

		const providers = await getSsoProvidersForOrg(org.id);

		// Strip encrypted config — never expose secrets to the client.
		return {
			providers: providers.map(({ encryptedConfig: _, ...p }) => p),
		};
	});

export const upsertSsoProviderProcedure = protectedProcedure
	.route({
		method: "PUT",
		path: "/enterprise/sso",
		tags: ["Enterprise - SSO"],
		summary: "Create or update saved SAML or OIDC provider settings",
	})
	.input(
		z.discriminatedUnion("type", [
			z.object({
				organizationSlug: z.string().min(1).max(255),
				type: z.literal("saml"),
				domain: z
					.string()
					.min(1)
					.regex(
						/^[a-z0-9.-]+\.[a-z]{2,}$/,
						"Must be a valid domain",
					),
				providerName: z.string().max(100).optional(),
				config: z.object({
					entityId: z.string().min(1, "IdP Entity ID is required"),
					ssoUrl: z.string().url("SSO URL must be a valid URL"),
					certificate: z
						.string()
						.min(1, "X.509 certificate is required"),
					spEntityId: z.string().min(1, "SP Entity ID is required"),
					spAcsUrl: z.string().url("ACS URL must be a valid URL"),
				}),
			}),
			z.object({
				organizationSlug: z.string().min(1).max(255),
				type: z.literal("oidc"),
				domain: z
					.string()
					.min(1)
					.regex(
						/^[a-z0-9.-]+\.[a-z]{2,}$/,
						"Must be a valid domain",
					),
				providerName: z.string().max(100).optional(),
				config: z.object({
					issuer: z.string().url("Issuer must be a valid URL"),
					clientId: z.string().min(1, "Client ID is required"),
					clientSecret: z
						.string()
						.min(1, "Client Secret is required"),
					redirectUri: z
						.string()
						.url("Redirect URI must be a valid URL"),
					scopes: z
						.array(z.string())
						.default(["openid", "email", "profile"]),
				}),
			}),
		]),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "sso");

		// Encrypt the full config before storing.
		const encryptedConfig = encryptConfig(
			input.config as Record<string, unknown>,
		);

		// Build non-sensitive display metadata.
		const metadata: Record<string, unknown> =
			input.type === "saml"
				? {
						entityId: input.config.entityId,
						ssoUrl: input.config.ssoUrl,
					}
				: {
						issuer: input.config.issuer,
						clientId: input.config.clientId,
						scopes: input.config.scopes,
					};

		const provider = await upsertSsoProvider({
			orgId: org.id,
			type: input.type,
			domain: input.domain,
			providerName: input.providerName,
			encryptedConfig,
			metadata,
			createdBy: user.id,
		});

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.sso.provider.upserted",
			entityType: "enterprise_sso_provider",
			entityId: provider.id,
			details: { type: input.type, domain: input.domain },
		});

		const { encryptedConfig: _, ...safeProvider } = provider;
		return { provider: safeProvider };
	});

export const updateSsoStatusProcedure = protectedProcedure
	.route({
		method: "PATCH",
		path: "/enterprise/sso/{providerId}/status",
		tags: ["Enterprise - SSO"],
		summary: "Activate, deactivate, or set a provider to testing mode",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			providerId: z.string().uuid(),
			status: z.enum(["active", "inactive", "testing"]),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "sso");

		const provider = await getSsoProviderById(input.providerId);
		if (!provider || provider.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", {
				message: "SSO provider not found.",
			});
		}

		const updated = await updateSsoProviderStatus(
			input.providerId,
			input.status,
		);
		if (!updated) {
			throw new ORPCError("NOT_FOUND", {
				message: "Failed to update SSO provider status.",
			});
		}

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.sso.provider.status_updated",
			entityType: "enterprise_sso_provider",
			entityId: input.providerId,
			details: { status: input.status },
		});

		const { encryptedConfig: _, ...safeProvider } = updated;
		return { provider: safeProvider };
	});

export const deleteSsoProviderProcedure = protectedProcedure
	.route({
		method: "DELETE",
		path: "/enterprise/sso/{providerId}",
		tags: ["Enterprise - SSO"],
		summary: "Delete an SSO provider configuration",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			providerId: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "sso");

		const provider = await getSsoProviderById(input.providerId);
		if (!provider || provider.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", {
				message: "SSO provider not found.",
			});
		}

		await deleteSsoProvider(input.providerId);

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.sso.provider.deleted",
			entityType: "enterprise_sso_provider",
			entityId: input.providerId,
			details: { type: provider.type, domain: provider.domain },
		});

		return { success: true };
	});
