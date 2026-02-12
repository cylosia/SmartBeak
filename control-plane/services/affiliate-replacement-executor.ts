

import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

const logger = getLogger('affiliate-replacement');

const MAX_CONTENT_VERSIONS = 1000;

export interface ReplacementInput {
  intentId: string;
  orgId: string; // P1-FIX: Added org scoping for authorization
  fromAffiliateOfferId: string;
  toAffiliateOfferId?: string;
  contentVersionIds: string[];
}

export interface ReplacementResult {
  affected: number;
}

export interface ContentVersion {
  id: string;
  [key: string]: unknown;
}

export interface HumanIntent {
  id: string;
  status: string;
  [key: string]: unknown;
}

/**
* Executes a governed affiliate offer replacement.
* - Requires approved human intent scoped to the caller's org
* - Creates new content versions
* - Preserves prior versions
* - Logs replacement
*
* @param pool - PostgreSQL connection pool
* @param input - Replacement parameters (must include orgId for authorization)
* @returns Result with count of affected content versions
* @throws Error if validation fails or database operation fails
*/
export async function executeAffiliateReplacement(
  pool: Pool,
  input: ReplacementInput
): Promise<ReplacementResult> {
  // Input validation
  if (!pool) {
  throw new Error('Database pool is required');
  }
  if (!input || typeof input !== 'object') {
  throw new Error('Input is required');
  }
  if (!input.intentId || typeof input.intentId !== 'string') {
  throw new Error('Valid intentId (string) is required');
  }
  // P1-FIX: Require orgId for authorization
  if (!input.orgId || typeof input.orgId !== 'string') {
  throw new Error('Valid orgId (string) is required');
  }
  if (!input.fromAffiliateOfferId || typeof input.fromAffiliateOfferId !== 'string') {
  throw new Error('Valid fromAffiliateOfferId (string) is required');
  }
  if (input.toAffiliateOfferId !== undefined && typeof input.toAffiliateOfferId !== 'string') {
  throw new Error('toAffiliateOfferId must be a string if provided');
  }
  if (!Array.isArray(input.contentVersionIds) || input.contentVersionIds.length === 0) {
  throw new Error('contentVersionIds must be a non-empty array');
  }
  if (!input.contentVersionIds.every(id => typeof id === 'string')) {
  throw new Error('All contentVersionIds must be strings');
  }

  // P1-FIX: Removed duplicate validation check and local const shadowing module-level
  if (input.contentVersionIds.length > MAX_CONTENT_VERSIONS) {
  throw new Error(`Cannot process more than ${MAX_CONTENT_VERSIONS} content versions at once`);
  }

  const client = await pool.connect();

  try {
  await client.query('BEGIN');
  await client.query('SET LOCAL statement_timeout = $1', [60000]); // 60 seconds for long-running batch operations

  // P1-FIX: Check for approved intent scoped to the caller's organization
  const intentResult = await client.query<HumanIntent>(
    'SELECT id, status FROM human_intents WHERE id = $1 AND status = $2 AND org_id = $3',
    [input.intentId, 'approved', input.orgId]
  );

  if (intentResult.rows.length === 0) {
    throw new Error('Approved intent required (not found or not authorized for this organization)');
  }

  // P1-FIX: Batch SELECT to eliminate N+1 query pattern (was up to 2000 individual queries)
  const existingResult = await client.query<ContentVersion>(
    'SELECT id FROM content_versions WHERE id = ANY($1::text[])',
    [input.contentVersionIds]
  );

  const existingIds = new Set(existingResult.rows.map(r => r["id"]));
  const missingIds = input.contentVersionIds.filter(id => !existingIds.has(id));
  if (missingIds.length > 0) {
    logger.warn('Content versions not found', { missingIds });
  }

  const foundIds = input.contentVersionIds.filter(id => existingIds.has(id));

  // P1-FIX: Batch INSERT for all found content versions
  let affectedCount = 0;
  if (foundIds.length > 0) {
    const insertResult = await client.query(
    `INSERT INTO content_versions (previous_version_id, updated_at)
    SELECT unnest($1::text[]), NOW()
    RETURNING id`,
    [foundIds]
    );
    affectedCount = insertResult.rowCount ?? 0;
  }

  const affected = foundIds.length;
  await client.query(
    `INSERT INTO affiliate_replacements
    (from_affiliate_offer_id, to_affiliate_offer_id, executed_intent_id, affected_content_count)
    VALUES ($1, $2, $3, $4)`,
    [
      input.fromAffiliateOfferId,
      input.toAffiliateOfferId ?? null,
      input.intentId,
      affected,
    ]
  );

  await client.query(
    `INSERT INTO audit_logs (action, entity_type, entity_id, details, created_at)
    VALUES ($1, $2, $3, $4, NOW())`,
    [
    'affiliate_replacement_executed',
    'affiliate_replacement',
    input.intentId,
    JSON.stringify({
    fromAffiliateOfferId: input.fromAffiliateOfferId,
    toAffiliateOfferId: input.toAffiliateOfferId,
    affectedContentCount: affected,
    contentVersionIds: foundIds,
    })
    ]
  );

  await client.query('COMMIT');

  await logAuditTrail(input, affected);

  logger.info(`Executed replacement affecting ${affected} content versions`, {
    intentId: input.intentId,
  });

  return { affected };
  } catch (error) {
  await client.query('ROLLBACK');
  logger.error('Error executing replacement', error instanceof Error ? error : new Error(String(error)), {
    intentId: input.intentId
  });
  throw error;
  } finally {
  client.release();
  }
}

async function logAuditTrail(input: ReplacementInput, affected: number): Promise<void> {
  logger.info('AFFILIATE_REPLACEMENT_AUDIT', {
  action: 'AFFILIATE_REPLACEMENT_EXECUTED',
  intentId: input.intentId,
  fromAffiliateOfferId: input.fromAffiliateOfferId,
  toAffiliateOfferId: input.toAffiliateOfferId,
  contentVersionCount: input.contentVersionIds.length,
  affectedCount: affected,
  timestamp: new Date().toISOString(),
  });
}
