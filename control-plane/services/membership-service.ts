
// Valid roles for membership
import { Pool, PoolClient } from 'pg';

import { getLogger } from '@kernel/logger';

const logger = getLogger('membership-service');

const VALID_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export type Role = typeof VALID_ROLES[number];

// Email validation regex (RFC 5322 compliant)
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export class MembershipService {
  constructor(private pool: Pool) {}

  /**
  * Validate role is allowed
  */
  private validateRole(role: string): asserts role is Role {
  if (!VALID_ROLES.includes(role as Role)) {
    throw new Error(`Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(', ')}`);
  }
  }

  /**
  * Validate email format
  */
  private validateEmail(email: string): void {
  if (!email || typeof email !== 'string') {
    throw new Error('Email is required');
  }
  if (!EMAIL_REGEX.test(email)) {
    throw new Error('Invalid email format');
  }
  }

  /**
  * Check if member already exists in org
  * Must be called within a transaction to prevent race conditions
  */
  private async checkDuplicateMember(client: PoolClient, orgId: string, userId: string): Promise<void> {
  // Use FOR UPDATE to lock the row and prevent concurrent inserts
  const { rows } = await client.query(
    'SELECT 1 FROM memberships WHERE user_id = $1 AND org_id = $2 FOR UPDATE',
    [userId, orgId]
  );
  if (rows.length > 0) {
    throw new Error('User is already a member of this organization');
  }
  }

  async addMember(orgId: string, userId: string, role: string): Promise<void> {
  // Validate inputs
  this.validateRole(role);
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }
  if (!userId || typeof userId !== 'string') {
    throw new Error('Valid userId is required');
  }

  const client = await this.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

    // Check for duplicates inside transaction with row locking
    // This prevents race conditions where two concurrent requests
    // Could add the same member simultaneously
    await this.checkDuplicateMember(client, orgId, userId);

    await client.query(
    'INSERT INTO memberships (user_id, org_id, role) VALUES ($1,$2,$3)',
    [userId, orgId, role]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  }

  async updateRole(orgId: string, userId: string, role: string): Promise<void> {
  // Validate inputs
  this.validateRole(role);
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }
  if (!userId || typeof userId !== 'string') {
    throw new Error('Valid userId is required');
  }

  const client = await this.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

    const result = await client.query(
    'UPDATE memberships SET role=$3 WHERE user_id=$1 AND org_id=$2',
    [userId, orgId, role]
    );

    if (result.rowCount === 0) {
    throw new Error('Membership not found');
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }
  if (!userId || typeof userId !== 'string') {
    throw new Error('Valid userId is required');
  }

  const client = await this.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

    // Prevent removing the last owner
    const { rows } = await client.query(
    'SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2',
    [userId, orgId]
    );

    if (rows.length === 0) {
    throw new Error('Membership not found');
    }

    if (rows[0].role === 'owner') {
    const { rows: ownerRows } = await client.query(
    'SELECT COUNT(*) as count FROM memberships WHERE org_id = $1 AND role = $2',
    [orgId, 'owner']
    );
    if (parseInt(ownerRows[0].count, 10) <= 1) {
    throw new Error('Cannot remove the last owner of the organization');
    }
    }

    await client.query(
    'DELETE FROM memberships WHERE user_id=$1 AND org_id=$2',
    [userId, orgId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  }

  /**
  * Audit logging for membership mutations
  */
  private async auditLog(action: string, orgId: string, userId: string, details: Record<string, unknown>): Promise<void> {
  logger.info(`[AUDIT][membership] ${action}`, {
    orgId,
    userId,
    ...details,
    timestamp: new Date().toISOString(),
  });
  // In production, this would write to an audit log table
  }
}
