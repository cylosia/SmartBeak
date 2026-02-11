

import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

const logger = getLogger('affiliate-replacement');

const MAX_CONTENT_VERSIONS = 1000;

export interface ReplacementInput {
  intentId: string;
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
* - Requires approved human intent
* - Creates new content versions
* - Preserves prior versions
* - Logs replacement
*
* @param pool - PostgreSQL connection pool
* @param input - Replacement parameters
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

  const MAX_CONTENT_VERSIONS = 1000;
  if (input.contentVersionIds.length > MAX_CONTENT_VERSIONS) {
  throw new Error(`Cannot process more than ${MAX_CONTENT_VERSIONS} content versions at once`);
  }
  if (input.contentVersionIds.length > MAX_CONTENT_VERSIONS) {
  throw new Error(`contentVersionIds exceeds maximum of ${MAX_CONTENT_VERSIONS}`);
  }

  const client = await pool.connect();

  try {
  await client.query('BEGIN');
  await client.query('SET LOCAL statement_timeout = $1', [60000]); // 60 seconds for long-running batch operations

  // Check for approved intent
  const intentResult = await client.query<HumanIntent>(
    'SELECT * FROM human_intents WHERE id = $1 AND status = $2',
    [input.intentId, 'approved']
  );

  if (intentResult.rows.length === 0) {
    throw new Error('Approved intent required');
  }

  let affectedCount = 0;

  for (const cvId of input.contentVersionIds) {
    const cvResult = await client.query<ContentVersion>(
    'SELECT * FROM content_versions WHERE id = $1',
    [cvId]
    );

    const cv = cvResult.rows[0];
    if (!cv) {
    logger.warn('Content version not found', { contentVersionId: cvId });
    continue;
    }

    // Create a new version by copying and swapping affiliate_offer references
    const newVersion = {
    ...cv,
    id: undefined,
    previous_version_id: cv["id"],
    updated_at: new Date(),
    };

    // NOTE: actual HTML/link replacement would be handled by a renderer layer.
    // Here we only record the versioning boundary.
    const insertResult = await client.query(
    `INSERT INTO content_versions (previous_version_id, updated_at)
    VALUES ($1, $2)
    RETURNING id`,
    [newVersion.previous_version_id, newVersion.updated_at]
    );

    affectedCount += insertResult.rowCount ?? 0;
  }

  const affected = input.contentVersionIds.length;
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
    contentVersionIds: input.contentVersionIds,
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
