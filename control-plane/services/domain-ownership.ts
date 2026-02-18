

import { Pool, PoolClient } from 'pg';

import { getLogger } from '@kernel/logger';

const logger = getLogger('domain-ownership');

// P2-FIX: Proper class instead of `new Error(...) as DomainError` cast.
// The old cast produces objects where `instanceof DomainError` returns false,
// silently breaking any caller that type-narrows on it.
export class DomainError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class DomainOwnershipService {
  constructor(private pool: Pool) {}

  async assertOrgOwnsDomain(orgId: string, domainId: string, client?: PoolClient) {
  const db = client || this.pool;
  // P1-TOCTOU-FIX: Added FOR UPDATE when running inside a transaction (client provided).
  // Without the lock, a concurrent transferDomain() could change ownership between
  // this SELECT and the callback in withOwnershipCheck(), allowing the callback to
  // operate on a domain the org no longer owns (silent authorization bypass).
  // When called without a client (pool.query), no locking is applied since we're
  // outside a transaction and FOR UPDATE requires an active transaction.
  const lockClause = client ? 'FOR UPDATE' : '';
  const { rows } = await db.query(
    `SELECT 1 FROM domain_registry WHERE id=$1 AND org_id=$2 ${lockClause}`,
    [domainId, orgId]
  );
  if (rows.length === 0) {
    throw new DomainError('Domain not owned by organization', 'DOMAIN_NOT_OWNED');
  }
  }

  /**
  * Transfer domain ownership with transaction protection
  * P1-13 FIX: Added retry for SERIALIZABLE serialization failures (error code 40001)
  */
  async transferDomain(domainId: string, fromOrg: string, toOrg: string): Promise<void> {
  const MAX_SERIALIZATION_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_SERIALIZATION_RETRIES; attempt++) {
    const client = await this.pool.connect();

    try {
    // Use SERIALIZABLE to prevent concurrent modifications
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

    // Lock the row for update to prevent concurrent transfers
    const { rows } = await client.query(
      'SELECT org_id FROM domain_registry WHERE id = $1 FOR UPDATE',
      [domainId]
    );

    if (rows.length === 0) {
      // P1-FIX: Do NOT call ROLLBACK explicitly before throwing. The catch block
      // already calls ROLLBACK unconditionally. Calling it here causes a double ROLLBACK:
      // PostgreSQL issues a warning, and it signals broken transaction state management.
      throw new DomainError('Domain not found', 'DOMAIN_NOT_FOUND');
    }

    // Verify current ownership
    if (rows[0].org_id !== fromOrg) {
      throw new DomainError('Domain not owned by source organization', 'DOMAIN_NOT_OWNED');
    }

    // Perform transfer
    const { rowCount } = await client.query(
      'UPDATE domain_registry SET org_id=$1, updated_at=NOW() WHERE id=$2 AND org_id=$3',
      [toOrg, domainId, fromOrg]
    );

    // CROSS-2-FIX P0: pg types rowCount as `number | null` (null for non-DML).
    // `null === 0` is false — without this guard a failed UPDATE silently commits,
    // recording a phantom transfer in the audit log.
    if ((rowCount ?? 0) === 0) {
      throw new DomainError('Transfer failed - domain may have been modified concurrently', 'TRANSFER_FAILED');
    }

    // Log the transfer for audit
    await client.query(
      `INSERT INTO domain_transfer_log (domain_id, from_org_id, to_org_id, transferred_at)
      VALUES ($1, $2, $3, NOW())`,
      [domainId, fromOrg, toOrg]
    );

    await client.query('COMMIT');
    return; // Success - exit the retry loop
    } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: Error) => {
      logger.error('Rollback failed', rollbackError);
    });

    // P1-13 FIX: Retry on serialization failures (PostgreSQL error code 40001)
    const pgError = error as { code?: string };
    if (pgError.code === '40001' && attempt < MAX_SERIALIZATION_RETRIES - 1) {
      // P2-FIX: Exponential backoff with jitter before retry. Without a delay, all
      // concurrent retries collide again immediately, guaranteeing repeated failures.
      const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000) + Math.random() * 50;
      logger.warn('Serialization failure during domain transfer, retrying with backoff', {
      domainId, attempt: attempt + 1, maxRetries: MAX_SERIALIZATION_RETRIES, backoffMs,
      });
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      continue;
    }

    throw error;
    } finally {
    client.release();
    }
  }
  }

  /**
  * Execute callback with domain ownership verification and transaction
  */
  async withOwnershipCheck<T>(
  orgId: string,
  domainId: string,
  callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
  const client = await this.pool.connect();

  try {
    // OWN-3-FIX P2: Use REPEATABLE READ so the ownership SELECT and subsequent
    // callback operations see a consistent snapshot, preventing TOCTOU races.
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

    // Verify ownership within transaction
    await this.assertOrgOwnsDomain(orgId, domainId, client);

    // Execute callback
    const result = await callback(client);

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => {
    logger["error"]('Rollback failed', rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
    });
    throw error;
  } finally {
    client.release();
  }
  }
}
