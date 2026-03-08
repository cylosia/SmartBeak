/**
 * Enterprise SCIM — Provisioning token management procedures.
 *
 * Raw tokens are only returned once at creation time.
 * Only a SHA-256 hash is stored in the database.
 */

import { ORPCError } from "@orpc/server";
import {
	createScimToken,
	deleteScimToken,
	getScimTokensForOrg,
} from "@repo/database";
import z from "zod";
import { enforceRateLimit } from "../../../../infrastructure/rate-limit-redis";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { generateScimToken, hashToken } from "../../lib/crypto";
import { requireEnterpriseFeature } from "../../lib/feature-gate";
import { requireOrgAdmin } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const listScimTokens = protectedProcedure
	.route({
		method: "GET",
		path: "/enterprise/scim/tokens",
		tags: ["Enterprise - SCIM"],
		summary: "List SCIM provisioning tokens for an organization",
	})
	.input(z.object({ organizationSlug: z.string().min(1) }))
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "scim");

		const tokens = await getScimTokensForOrg(org.id);
		return {
			tokens: tokens.map(({ tokenHash: _, ...t }) => t),
		};
	});

export const createScimTokenProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/enterprise/scim/tokens",
		tags: ["Enterprise - SCIM"],
		summary: "Create a new SCIM provisioning token",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			description: z.string().max(200).optional(),
			expiresInDays: z.number().int().min(1).max(365).optional(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "scim");

		await enforceRateLimit(`org:${org.id}:scim-token-create`, {
			limit: 5,
			windowSeconds: 3600,
		});

		const rawToken = generateScimToken();
		const tokenHash = hashToken(rawToken);
		const tokenSuffix = rawToken.slice(-4);

		const expiresAt = input.expiresInDays
			? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
			: undefined;

		const token = await createScimToken({
			orgId: org.id,
			tokenHash,
			tokenSuffix,
			description: input.description,
			expiresAt,
			createdBy: user.id,
		});

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.scim.token.created",
			entityType: "enterprise_scim_token",
			entityId: token.id,
			details: { description: input.description },
		});

		// Return the raw token ONCE — it cannot be retrieved again.
		const { tokenHash: _, ...safeToken } = token;
		return {
			token: {
				...safeToken,
				rawToken,
			},
		};
	});

export const deleteScimTokenProcedure = protectedProcedure
	.route({
		method: "DELETE",
		path: "/enterprise/scim/tokens/{tokenId}",
		tags: ["Enterprise - SCIM"],
		summary: "Revoke a SCIM provisioning token",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			tokenId: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "scim");

		const tokens = await getScimTokensForOrg(org.id);
		const token = tokens.find((t) => t.id === input.tokenId);
		if (!token) {
			throw new ORPCError("NOT_FOUND", {
				message: "SCIM token not found.",
			});
		}

		await deleteScimToken(input.tokenId);

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.scim.token.deleted",
			entityType: "enterprise_scim_token",
			entityId: input.tokenId,
			details: { description: token.description },
		});

		return { success: true };
	});
