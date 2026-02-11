

import { Pool, PoolClient } from 'pg';

import { getLogger } from '@kernel/logger';

const logger = getLogger('domain-ownership');

export interface DomainError extends Error {
  code: string;
}

export class DomainOwnershipService {
  constructor(private pool: Pool) {}

  async assertOrgOwnsDomain(orgId: string, domainId: string, client?: PoolClient) {
  const db = client || this.pool;
  const { rows } = await db.query(
    'SELECT 1 FROM domain_registry WHERE id=$1 AND org_id=$2',
    [domainId, orgId]
  );
  if (rows.length === 0) {
    const error = new Error('Domain not owned by organization') as DomainError;
    error.code = 'DOMAIN_NOT_OWNED';
    throw error;
  }
  }

  /**
  * Transfer domain ownership with transaction protection
  */
  async transferDomain(domainId: string, fromOrg: string, toOrg: string): Promise<void> {
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
    await client.query('ROLLBACK');
    const error = new Error('Domain not found') as DomainError;
    error.code = 'DOMAIN_NOT_FOUND';
    throw error;
    }

    // Verify current ownership
    if (rows[0].org_id !== fromOrg) {
    await client.query('ROLLBACK');
    const error = new Error('Domain not owned by source organization') as DomainError;
    error.code = 'DOMAIN_NOT_OWNED';
    throw error;
    }

    // Perform transfer
    const { rowCount } = await client.query(
    'UPDATE domain_registry SET org_id=$1, updated_at=NOW() WHERE id=$2 AND org_id=$3',
    [toOrg, domainId, fromOrg]
    );

    if (rowCount === 0) {
    await client.query('ROLLBACK');
    const error = new Error('Transfer failed - domain may have been modified') as DomainError;
    error.code = 'TRANSFER_FAILED';
    throw error;
    }

    // Log the transfer for audit
    await client.query(
    `INSERT INTO domain_transfer_log (domain_id, from_org_id, to_org_id, transferred_at)
    VALUES ($1, $2, $3, NOW())`,
    [domainId, fromOrg, toOrg]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: Error) => {
    logger["error"]('Rollback failed', rollbackError);
    });
    throw error;
  } finally {
    client.release();
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
    await client.query('BEGIN');
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
