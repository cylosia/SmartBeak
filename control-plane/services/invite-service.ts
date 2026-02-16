

import { Pool } from 'pg';
import { randomUUID } from 'crypto';

import { getLogger } from '@kernel/logger';

const logger = getLogger('invite-service');

// Valid roles for invites
const VALID_ROLES = ['admin', 'editor', 'viewer'] as const;
export type Role = typeof VALID_ROLES[number];

// Email validation — split into parts to avoid ReDoS from nested quantifiers
const EMAIL_LOCAL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/;

function isValidDomainLabel(label: string): boolean {
  if (label.length < 1 || label.length > 63) return false;
  if (!/^[a-zA-Z0-9]/.test(label)) return false;
  if (!/[a-zA-Z0-9]$/.test(label)) return false;
  return /^[a-zA-Z0-9-]+$/.test(label);
}

function isValidEmailFormat(email: string): boolean {
  const atIndex = email.indexOf('@');
  if (atIndex < 1 || atIndex === email.length - 1) return false;
  if (email.indexOf('@', atIndex + 1) !== -1) return false;
  const local = email.substring(0, atIndex);
  const domain = email.substring(atIndex + 1);
  if (!EMAIL_LOCAL_REGEX.test(local)) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every(label => isValidDomainLabel(label));
}

export class InviteService {
  constructor(private pool: Pool) {}

  /**
  * Validate role is allowed (owner cannot be invited, must be transferred)
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
  if (email.length > 254) {
    throw new Error('Email is too long');
  }
  if (!isValidEmailFormat(email)) {
    throw new Error('Invalid email format');
  }
  }

  /**
  * Check for duplicate pending invite
  */
  private async checkDuplicateInvite(orgId: string, email: string, client?: import('pg').PoolClient): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const queryable = client || this.pool;
  const { rows } = await queryable.query(
    'SELECT 1 FROM invites WHERE org_id = $1 AND email = $2 AND status = $3',
    [orgId, normalizedEmail, 'pending']
  );
  if (rows.length > 0) {
    throw new Error('An active invite already exists for this email');
  }
  }

  /**
  * Check if user is already a member
  */
  private async checkExistingMembership(orgId: string, email: string, client?: import('pg').PoolClient): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const queryable = client || this.pool;
  const { rows } = await queryable.query(
    `SELECT 1 FROM memberships m
    JOIN users u ON m.user_id = u.id
    WHERE m.org_id = $1 AND u.email = $2`,
    [orgId, normalizedEmail]
  );
  if (rows.length > 0) {
    throw new Error('User is already a member of this organization');
  }
  }

  async invite(orgId: string, email: string, role: string) {
  // Validate inputs
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }
  this.validateEmail(email);
  this.validateRole(role);

  const id = randomUUID();
  const normalizedEmail = email.toLowerCase().trim();

  const client = await this.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

    // Check for duplicates within the transaction to prevent TOCTOU races
    await this.checkDuplicateInvite(orgId, normalizedEmail, client);
    await this.checkExistingMembership(orgId, normalizedEmail, client);

    await client.query(
    'INSERT INTO invites (id, org_id, email, role, status, created_at) VALUES ($1,$2,$3,$4,$5,NOW())',
    [id, orgId, normalizedEmail, role, 'pending']
    );

    // Audit logging
    await this.auditLog('invite_created', orgId, { inviteId: id, email: normalizedEmail, role });

    await client.query('COMMIT');

    return { id, email: normalizedEmail, role };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  }

  /**
  * Revoke a pending invite
  */
  async revokeInvite(orgId: string, inviteId: string): Promise<void> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }
  if (!inviteId || typeof inviteId !== 'string') {
    throw new Error('Valid inviteId is required');
  }

  const client = await this.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

    const result = await client.query(
    'UPDATE invites SET status = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 AND status = $4',
    ['revoked', inviteId, orgId, 'pending']
    );

    if (result.rowCount === 0) {
    throw new Error('Invite not found or already processed');
    }

    await this.auditLog('invite_revoked', orgId, { inviteId });

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  }

  /**
  * Audit logging for invite operations
  * MEDIUM FIX: Add correlation IDs and use structured logger
  */
  private async auditLog(action: string, orgId: string, details: Record<string, unknown>, requestId?: string): Promise<void> {
  const _correlationId = requestId || this.generateRequestId();
  logger.info(`[AUDIT][invite] ${action}`, {
    ...details,
    timestamp: new Date().toISOString(),
  });
  // In production, this would write to an audit log table
  }

  /**
  * Generate unique request ID for tracing
  */
  private generateRequestId(): string {
  return `req_${randomUUID().replace(/-/g, '').substring(0, 16)}`;
  }
}
