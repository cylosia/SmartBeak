

import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

const logger = getLogger('affiliate-revenue-confidence');

export interface AffiliateRevenueConfidence {
  affiliate_offer_id: string;
  confidence_score: number;
  sample_size: number;
  last_updated: Date;
  [key: string]: unknown;
}

/**
* Retrieves revenue confidence data for a specific affiliate offer.
*
* @param pool - PostgreSQL connection pool
* @param affiliateOfferId - The ID of the affiliate offer
* @returns The confidence record or null if not found
* @throws Error if validation fails or database operation fails
*/
export async function getAffiliateRevenueConfidence(
  pool: Pool,
  affiliateOfferId: string,
  orgId: string
): Promise<AffiliateRevenueConfidence | null> {
  // Input validation
  if (!pool) {
  throw new Error('Database pool is required');
  }
  if (!affiliateOfferId || typeof affiliateOfferId !== 'string') {
  throw new Error('Valid affiliateOfferId (string) is required');
  }
  // P1-FIX: Require orgId to prevent cross-tenant data access
  if (!orgId || typeof orgId !== 'string') {
  throw new Error('Valid orgId (string) is required');
  }

  try {
  const result = await pool.query<AffiliateRevenueConfidence>(
    'SELECT * FROM affiliate_revenue_confidence WHERE affiliate_offer_id = $1 AND org_id = $2',
    [affiliateOfferId, orgId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return row ?? null;
  } catch (error) {
  logger.error('Error fetching confidence', new Error(`error: ${error instanceof Error ? error.message : String(error)}`));
  throw new Error(`Failed to fetch revenue confidence: ${error instanceof Error ? error.message : String(error)}`);
  }
}
