import { ORPCError } from "@orpc/server";
import { getOrganizationBySlug, upsertSmartBeakOrg } from "@repo/database";
import {
	cachedGetOrgBySlug,
	cachedGetSmartBeakOrgBySlug,
} from "../../../infrastructure/redis-cache";

interface ResolvedOrg {
	id: string;
	name: string;
	slug: string;
	settings: unknown;
	createdAt: Date;
	updatedAt: Date;
	/** Supastarter organization ID (cuid) — use this for RBAC membership checks. */
	supastarterOrgId: string;
}

/**
 * Resolves a Supastarter organization slug into a SmartBeak organization
 * with a proper UUID id. If the SmartBeak org doesn't exist yet, it is
 * created automatically by syncing from the Supastarter org.
 *
 * Uses upsert to avoid TOCTOU race conditions between concurrent requests.
 * Org lookup is cached to avoid hitting the database on every request.
 *
 * Returns both the SmartBeak org (UUID id for data tables) and the
 * Supastarter org id (cuid for Better Auth membership checks).
 */
export async function resolveSmartBeakOrg(slug: string): Promise<ResolvedOrg> {
	const supastarterOrg = (await cachedGetOrgBySlug(slug, () =>
		getOrganizationBySlug(slug),
	)) as Awaited<ReturnType<typeof getOrganizationBySlug>>;

	if (!supastarterOrg) {
		throw new ORPCError("NOT_FOUND", {
			message: "Organization not found.",
		});
	}

	const smartBeakOrg = (await cachedGetSmartBeakOrgBySlug(slug, async () => {
		const rows = await upsertSmartBeakOrg({
			id: crypto.randomUUID(),
			name: supastarterOrg.name,
			slug,
		});
		const org = rows[0];
		if (!org) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "Failed to upsert SmartBeak organization.",
			});
		}
		return org;
	})) as Awaited<ReturnType<typeof upsertSmartBeakOrg>>[0];

	if (!smartBeakOrg) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Failed to resolve SmartBeak organization.",
		});
	}

	return { ...smartBeakOrg, supastarterOrgId: supastarterOrg.id };
}
