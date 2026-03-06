/**
 * Enterprise feature gate.
 *
 * Checks whether an organization's current billing tier grants access to a
 * specific enterprise feature. Throws FORBIDDEN if the feature is not included.
 */

import { ORPCError } from "@orpc/server";
import type { EnterpriseTierFeatures } from "@repo/database";
import { getOrgTier } from "@repo/database";
import { cachedGetOrgTier } from "../../../infrastructure/redis-cache";

type FeatureKey = keyof EnterpriseTierFeatures;

/**
 * Resolves the org tier and throws FORBIDDEN if the requested feature is
 * not enabled. Returns the org tier record for further use.
 *
 * @param orgId - The SmartBeak organization UUID.
 * @param feature - The feature key to check (e.g., "sso", "scim").
 */
export async function requireEnterpriseFeature(
	orgId: string,
	feature: FeatureKey,
) {
	const orgTier = (await cachedGetOrgTier(orgId, () =>
		getOrgTier(orgId),
	)) as Awaited<ReturnType<typeof getOrgTier>>;

	if (!orgTier?.tier) {
		// No tier configured — treat as Starter (no enterprise features).
		throw new ORPCError("FORBIDDEN", {
			message: `This feature requires an Enterprise plan. Please upgrade to access ${feature}.`,
		});
	}

	const features = orgTier.tier.features as EnterpriseTierFeatures | null;
	if (!features || !features[feature]) {
		throw new ORPCError("FORBIDDEN", {
			message: `The "${feature}" feature is not included in your current plan (${orgTier.tier.displayName}). Please upgrade to access this feature.`,
		});
	}

	return orgTier;
}

/**
 * Returns true if the org has the feature enabled, without throwing.
 * Useful for conditional rendering decisions.
 */
export async function hasEnterpriseFeature(
	orgId: string,
	feature: FeatureKey,
): Promise<boolean> {
	const orgTier = (await cachedGetOrgTier(orgId, () =>
		getOrgTier(orgId),
	)) as Awaited<ReturnType<typeof getOrgTier>>;
	if (!orgTier?.tier) {
		return false;
	}
	const features = orgTier.tier.features as EnterpriseTierFeatures | null;
	return !!features?.[feature];
}
