
// Valid roles for membership
import { Pool, PoolClient } from 'pg';

import { getLogger } from '@kernel/logger';
import { ValidationError, NotFoundError, ForbiddenError, ErrorCodes } from '@errors';

const logger = getLogger('membership-service');

const VALID_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export type Role = typeof VALID_ROLES[number];

// P1-19 FIX: Role hierarchy for permission checks
const ROLE_HIERARCHY: Record<Role, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

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

export class MembershipService {
  constructor(private pool: Pool) {}

  /**
   * Validate role is allowed
   */
  private validateRole(role: string): asserts role is Role {
    if (!VALID_ROLES.includes(role as Role)) {
      throw new ValidationError(`Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(', ')}`, ErrorCodes['VALIDATION_ERROR']);
    }
  }

  /**
   * Validate email format
   */
  private validateEmail(email: string): void {
    if (!email || typeof email !== 'string') {
      throw new ValidationError('Email is required', ErrorCodes['VALIDATION_ERROR']);
    }
    if (!isValidEmailFormat(email)) {
      throw new ValidationError('Invalid email format', ErrorCodes['VALIDATION_ERROR']);
    }
  }

  /**
   * P2-20 FIX: Validate input strings at method entry
   */
  private validateId(value: string, name: string): void {
    if (!value || typeof value !== 'string') {
      throw new ValidationError(`Valid ${name} is required`, ErrorCodes['VALIDATION_ERROR']);
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
      throw new ValidationError('User is already a member of this organization', ErrorCodes['VALIDATION_ERROR']);
    }
  }

  /**
   * P1-19 FIX: Check that the acting user has sufficient role to perform the action.
   * An actor can only assign/modify roles at or below their own level.
   */
  private async checkActorPermission(client: PoolClient, orgId: string, actorUserId: string, targetRole: Role): Promise<void> {
    const { rows } = await client.query(
      'SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2',
      [actorUserId, orgId]
    );
    if (rows.length === 0) {
      throw new ForbiddenError('Actor is not a member of this organization');
    }
    const actorRole = rows[0]?.['role'] as Role;
    const actorLevel = ROLE_HIERARCHY[actorRole] ?? 0;
    const targetLevel = ROLE_HIERARCHY[targetRole] ?? 0;
    if (targetLevel > actorLevel) {
      throw new ForbiddenError(`Cannot assign role '${targetRole}' - insufficient permissions`);
    }
  }

  async addMember(orgId: string, userId: string, role: Role, actorUserId?: string): Promise<void> {
    // P2-20 FIX: Validate inputs at method entry
    this.validateId(orgId, 'orgId');
    this.validateId(userId, 'userId');
    this.validateRole(role);

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL statement_timeout = $1', [30000]);

      // P1-19 FIX: Check actor has permission to assign this role
      if (actorUserId) {
        await this.checkActorPermission(client, orgId, actorUserId, role);
      }

      // Check for duplicates inside transaction with row locking
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

    // P3-5 FIX: Audit log OUTSIDE transaction to prevent audit failure blocking mutation
    await this.auditLog('addMember', orgId, userId, { role });
  }

  async updateRole(orgId: string, userId: string, role: Role, actorUserId?: string): Promise<void> {
    // P2-20 FIX: Validate inputs at method entry
    this.validateId(orgId, 'orgId');
    this.validateId(userId, 'userId');
    this.validateRole(role);

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL statement_timeout = $1', [30000]);

      // P1-19 FIX: Check actor has permission to assign this role
      if (actorUserId) {
        await this.checkActorPermission(client, orgId, actorUserId, role);
      }

      const result = await client.query(
        'UPDATE memberships SET role=$3 WHERE user_id=$1 AND org_id=$2',
        [userId, orgId, role]
      );

      if (result.rowCount === 0) {
        throw new NotFoundError('Membership not found');
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // P3-5 FIX: Audit log outside transaction
    await this.auditLog('updateRole', orgId, userId, { role });
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    this.validateId(orgId, 'orgId');
    this.validateId(userId, 'userId');

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL statement_timeout = $1', [30000]);

      // P1-4 FIX: Lock the row with FOR UPDATE to prevent TOCTOU race
      const { rows } = await client.query(
        'SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2 FOR UPDATE',
        [userId, orgId]
      );

      if (rows.length === 0) {
        throw new NotFoundError('Membership not found');
      }

      // P2-21 FIX: Use bracket notation for indexed access
      if (rows[0]?.['role'] === 'owner') {
        const { rows: ownerRows } = await client.query(
          'SELECT COUNT(*)::int as count FROM memberships WHERE org_id = $1 AND role = $2 FOR UPDATE',
          [orgId, 'owner']
        );
        if (Number(ownerRows[0]?.['count'] ?? 0) <= 1) {
          throw new ForbiddenError('Cannot remove the last owner of the organization');
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

    // P3-5 FIX: Audit log outside transaction
    await this.auditLog('removeMember', orgId, userId, {});
  }

  /**
   * Audit logging for membership mutations
   */
  private async auditLog(action: string, orgId: string, userId: string, details: Record<string, unknown>): Promise<void> {
    try {
      logger.info(`[AUDIT][membership] ${action}`, {
        orgId,
        userId,
        ...details,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // P2-25 FIX: Never let audit log failures propagate to callers
      logger.error('Audit log write failed', error instanceof Error ? error : new Error(String(error)));
    }
  }
}
