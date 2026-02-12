


import type { Knex } from 'knex';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { getDb } from '../db';

const TransferTokenSchema = z.object({
  id: z.string().uuid(),
  token: z.string(),
  domain_id: z.string().uuid(),
  to_org_id: z.string().uuid(),
  expires_at: z.date().nullable(),
  used_at: z.date().nullable(),
});

export type TransferToken = z.infer<typeof TransferTokenSchema>;

function validateTransferToken(row: unknown): TransferToken {
  const result = TransferTokenSchema.safeParse(row);
  if (!result.success) {
  throw new Error(`Invalid transfer token: ${result.error["message"]}`);
  }
  return result.data;
}

const logger = getLogger('domain-transfer');

/** Maximum retries for acquiring transfer token */
const MAX_ACQUIRE_RETRIES = 3;

/** Base delay in milliseconds for retry backoff */
const RETRY_BASE_DELAY_MS = 100;

// This ensures our locks don't collide with other features using hashtext
const LOCK_NAMESPACE = 44221;

const DomainTransferSchema = z.object({
  token: z.string().min(10, 'Token must be at least 10 characters'),
  requestedBy: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type DomainTransferInput = z.infer<typeof DomainTransferSchema>;

export interface TransferResult {
  status: string;
  domainId: string;
  toOrgId: string;
}

/**
* Domain Transfer Job
* Transfers domain ownership using database transaction with row-level locking
* to prevent race conditions
*/
export async function domainTransferJob(payload: unknown): Promise<TransferResult> {
  // Validate input
  let validatedInput: DomainTransferInput;
  try {
  validatedInput = DomainTransferSchema.parse(payload);
  } catch (error) {
  if (error instanceof Error) {
    logger.error('Invalid domain transfer payload: ' + (error instanceof Error ? error.message : String(error)));
    throw new Error(`Validation failed: ${error["message"]}`);
  }
  throw error;
  }

  const { token, requestedBy } = validatedInput;
  const normalizedToken = token.toLowerCase().trim();

  logger.info('Starting domain transfer', {
  });

  // This prevents race conditions where two concurrent requests try to use the same token
  const db = await getDb();
  return await db.transaction(async (trx) => {
  // Set transaction timeout to prevent long-running queries
  await trx.raw('SET LOCAL statement_timeout = ?', [30000]); // 30 seconds

  // Using two-parameter form: pg_try_advisory_xact_lock(namespace, id)
  const lockResult = await trx.raw(
    `SELECT pg_try_advisory_xact_lock(?, hashtext(?)) as acquired`,
    [LOCK_NAMESPACE, normalizedToken]
  );
  const acquired = lockResult.rows?.[0]?.acquired;

  if (!acquired) {
    throw new Error('Token is already being processed by another transaction');
  }

  // SkipLocked may skip valid rows under contention, so we retry
  const transfer = await acquireTransferWithRetry(trx, normalizedToken, 3);

  if (!transfer) {
    throw new Error('Token not found, already used, or being processed by another transaction');
  }

  if (transfer.expires_at && new Date(transfer.expires_at) < new Date()) {
    throw new Error('Transfer token has expired');
  }

  // Verify domain ownership transfer
  if (!transfer.domain_id || !transfer.to_org_id) {
    logger.error('Transfer record incomplete: transferId=' + transfer.id + ', hasDomainId=' + !!transfer.domain_id + ', hasOrgId=' + !!transfer.to_org_id);
    throw new Error('Transfer record is incomplete');
  }

  // Include the used_at condition in the UPDATE to ensure we only update if still unused
  const updateResult = await trx('domain_transfer_tokens')
    .where({ token: normalizedToken, used_at: null })  // Include condition in UPDATE
    .update({ used_at: new Date(), used_by: requestedBy })
    .returning(['id']);

  if (updateResult.length === 0) {
    throw new Error('Token was already used or not found');
  }

  // Perform the actual domain transfer within the same transaction
  const registryUpdated = await trx('domain_registry')
    .where({ domain_id: transfer.domain_id })
    .update({
    org_id: transfer.to_org_id,
    transferred_at: new Date(),
    transferred_from: requestedBy,
    })
    .returning(['domain_id']);

  if (registryUpdated.length === 0) {
    throw new Error('Domain registry update failed - domain may not exist');
  }

  logger.info('Domain transfer completed successfully: domainId=' + transfer.domain_id + ', toOrgId=' + transfer.to_org_id);

  return {
    status: 'transferred',
    domainId: transfer.domain_id,
    toOrgId: transfer.to_org_id,
  };
  });
}

/**

* skipLocked can skip rows even if they're not actually locked by concurrent transactions,
* just because of timing/visibility issues. We retry to handle this.
*/
async function acquireTransferWithRetry(
  trx: Knex.Transaction,
  token: string,
  maxRetries = MAX_ACQUIRE_RETRIES
): Promise<TransferToken | null> {
  for (let i = 0; i < maxRetries; i++) {
  const [transferResult] = await trx('domain_transfer_tokens')
    .where({ token })
    .whereNull('used_at')
    .forUpdate()
    .skipLocked()
    .select('*');

  if (transferResult) {

    return validateTransferToken(transferResult);
  }

  // Wait before retry with exponential backoff
  if (i < maxRetries - 1) {
    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, i);
    logger.debug('Token not acquired, retrying', { attempt: i + 1, delay });
    await new Promise(r => setTimeout(r, delay));
  }
  }
  return null;
}

// Export schema for reuse
export { DomainTransferSchema };
