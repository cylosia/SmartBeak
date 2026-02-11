/**
* WordPress site limits per pricing tier
*/
export const PRICING_TIERS: Record<string, { wordpressSites: number }> = {
  free: { wordpressSites: 0 },
  pro: { wordpressSites: 1 },
  agency: { wordpressSites: 10 }
};

/**
* Supported pricing tiers
*/
export type PricingTier = keyof typeof PRICING_TIERS;

/**
* Check if WordPress site limit is exceeded for the tier
* @param tier - The pricing tier
* @param connected - Number of connected WordPress sites
* @throws Error if limit is exceeded
* MEDIUM FIX M3: Added JSDoc documentation and improved error handling
*/
export function assertWordPressLimit(tier: string, connected: number): void {
  if (typeof tier !== 'string' || tier.length === 0) {
  throw new Error('Invalid tier: must be a non-empty string');
  }
  if (typeof connected !== 'number' || connected < 0 || !Number.isInteger(connected)) {
  throw new Error('Invalid connected: must be a non-negative integer');
  }

  const limit = PRICING_TIERS[tier]?.wordpressSites;
  if (limit === undefined) {
  throw new Error(`Unknown pricing tier: ${tier}`);
  }

  if (connected > limit) {
  throw new Error(`WordPress site limit exceeded for ${tier} plan: ${connected} > ${limit}`);
  }
}
