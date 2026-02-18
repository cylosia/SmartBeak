
// Valid roles for membership
import { Pool, PoolClient } from 'pg';

import { getLogger } from '@kernel/logger';
import { ValidationError, NotFoundError, ForbiddenError } from '@errors';

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

// FIX(P2): UUID regex for input validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
   * FIX(P2): ValidationError constructor second arg is `details`, not `code`.
   * ValidationError already hard-codes ErrorCodes.VALIDATION_ERROR internally.
   */
  private validateRole(role: string): asserts role is Role {
    if (!VALID_ROLES.includes(role as Role)) {
      throw new ValidationError(`Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(', ')}`);
    }
  }

  /**
   * Validate email format
   */
  private validateEmail(email: string): void {
    if (!email || typeof email !== 'string') {
      throw new ValidationError('Email is required');
    }
    if (!isValidEmailFormat(email)) {
      throw new ValidationError('Invalid email format');
    }
  }

  /**
   * P2-20 FIX: Validate input strings at method entry.
   * FIX(P2): Also validate UUID format — previously any non-empty string was
   * accepted, enabling org ID enumeration via 403/404 differential.
   */
  private validateId(value: string, name: string): void {
    if (!value || typeof value !== 'string') {
      throw new ValidationError(`Valid ${name} is required`);
    }
    if (!UUID_REGEX.test(value)) {
      throw new ValidationError(`${name} must be a valid UUID`);
    }
  }

  /**
   * Check if member already exists in org.
   * P1-FIX: Removed `FOR UPDATE` — it only locks *existing* rows. When no row
   * exists (the common case for a legitimate addMember call), no lock is acquired.
   * Two concurrent addMember calls for the same (user_id, org_id) pair will both
   * find zero rows, both proceed past this check, and both attempt INSERT.
   * The PRIMARY KEY constraint on (user_id, org_id) is the correct concurrency
   * guard; the pre-check is now a best-effort fast path that avoids hitting the
   * constraint, but callers must also handle the constraint violation on INSERT.
   */
  private async checkDuplicateMember(client: PoolClient, orgId: string, userId: string): Promise<void> {
    const { rows } = await client.query(
      'SELECT 1 FROM memberships WHERE user_id = $1 AND org_id = $2',
      [userId, orgId]
    );
    if (rows.length > 0) {
      throw new ValidationError('User is already a member of this organization');
    }
  }

  /**
   * P1-19 FIX: Check that the acting user has sufficient role to perform the action.
   * FIX(P1): Changed `targetLevel > actorLevel` to `targetLevel >= actorLevel` AND
   * added explicit guard preventing admins from granting admin to others.
   * Previously: admin could promote other users to admin (same level, check passed).
   * Now: only owners can grant or modify admin-level roles.
   * P1-FIX: Validate role from DB before unsafe `as Role` cast — a corrupt or
   * legacy role value would produce `ROLE_HIERARCHY[actorRole] = undefined`,
   * then `?? 0` would silently degrade a legitimate owner to viewer-level,
   * blocking legitimate operations with a misleading ForbiddenError.
   */
  private async checkActorPermission(client: PoolClient, orgId: string, actorUserId: string, targetRole: Role): Promise<void> {
    const { rows } = await client.query(
      'SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2',
      [actorUserId, orgId]
    );
    if (rows.length === 0) {
      throw new ForbiddenError('Actor is not a member of this organization');
    }
    // P1-FIX: Validate raw DB value before casting to avoid silent role degradation
    const rawRole = rows[0]?.['role'];
    if (typeof rawRole !== 'string' || !VALID_ROLES.includes(rawRole as Role)) {
      throw new ForbiddenError('Actor has an invalid or unrecognized role in this organization');
    }
    const actorRole = rawRole as Role;
    const actorLevel = ROLE_HIERARCHY[actorRole] ?? 0;
    const targetLevel = ROLE_HIERARCHY[targetRole] ?? 0;
    // Only owners can grant or modify admin-level memberships
    if (targetRole === 'admin' && actorRole !== 'owner') {
      throw new ForbiddenError(`Only owners can assign the 'admin' role`);
    }
    // Actors cannot assign roles at their own level or above (except owners are exempt
    // from the same-level check since they assign other owners in ownership transfer)
    if (targetLevel >= actorLevel && actorRole !== 'owner') {
      throw new ForbiddenError(`Cannot assign role '${targetRole}' - insufficient permissions`);
    }
  }

  /**
   * FIX(P1): ROLLBACK failures now log the error and preserve the original
   * exception. Previously a network failure during ROLLBACK would silently
   * replace the original business error with a confusing connection error.
   */
  private async safeRollback(client: PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      logger.error('ROLLBACK failed — connection may be in bad state', rbErr instanceof Error ? rbErr : new Error(String(rbErr)));
    }
  }

  /**
   * P0-FIX: `actorUserId` is now required (was `actorUserId?: string`).
   * Previously, when omitted, the entire actor-permission check was silently
   * skipped, meaning ANY authenticated caller could add members at ANY role
   * including 'owner' with zero permission verification. This is a live P0
   * authorization bypass in production: orgs.ts:215 was not passing actorUserId,
   * so every addMember request bypassed role-permission enforcement entirely.
   * For system/bootstrap calls use addMemberInternal() below.
   */
  async addMember(orgId: string, userId: string, role: Role, actorUserId: string): Promise<void> {
    // P2-20 FIX: Validate inputs at method entry
    this.validateId(orgId, 'orgId');
    this.validateId(userId, 'userId');
    this.validateId(actorUserId, 'actorUserId');
    this.validateRole(role);

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL statement_timeout = $1', [30000]);

      // P1-19 FIX: Check actor has permission to assign this role.
      await this.checkActorPermission(client, orgId, actorUserId, role);

      // Best-effort fast-path duplicate check (non-locking). The real concurrency
      // guard is the PRIMARY KEY constraint; handle violation in the catch below.
      await this.checkDuplicateMember(client, orgId, userId);

      await client.query(
        'INSERT INTO memberships (user_id, org_id, role) VALUES ($1,$2,$3)',
        [userId, orgId, role]
      );

      await client.query('COMMIT');
    } catch (error) {
      await this.safeRollback(client);
      // P1-FIX: Convert PRIMARY KEY constraint violation (23505) to a user-friendly
      // ValidationError instead of leaking a raw PostgreSQL error as a 500.
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === '23505') {
        throw new ValidationError('User is already a member of this organization');
      }
      throw error;
    } finally {
      client.release();
    }

    // P3-5 FIX: Audit log OUTSIDE transaction to prevent audit failure blocking mutation
    await this.auditLog('addMember', orgId, userId, { role });
  }

  /**
   * Internal-only addMember for system/bootstrap operations that do not have
   * an actor context (e.g., org creation, migrations). Bypasses actor-permission
   * check. Never expose this to HTTP routes.
   */
  async addMemberInternal(orgId: string, userId: string, role: Role): Promise<void> {
    this.validateId(orgId, 'orgId');
    this.validateId(userId, 'userId');
    this.validateRole(role);

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL statement_timeout = $1', [30000]);
      await this.checkDuplicateMember(client, orgId, userId);
      await client.query(
        'INSERT INTO memberships (user_id, org_id, role) VALUES ($1,$2,$3)',
        [userId, orgId, role]
      );
      await client.query('COMMIT');
    } catch (error) {
      await this.safeRollback(client);
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === '23505') {
        throw new ValidationError('User is already a member of this organization');
      }
      throw error;
    } finally {
      client.release();
    }

    await this.auditLog('addMemberInternal', orgId, userId, { role });
  }

  /**
   * P0-FIX: `actorUserId` is now required (was optional).
   * Same authorization bypass as addMember — see addMember for details.
   * P1-FIX: Added `updated_at = NOW()` so role changes are traceable at the
   * database level (previously only the application log recorded the change;
   * the row itself showed no evidence of mutation time, defeating audit trails).
   */
  async updateRole(orgId: string, userId: string, role: Role, actorUserId: string): Promise<void> {
    // P2-20 FIX: Validate inputs at method entry
    this.validateId(orgId, 'orgId');
    this.validateId(userId, 'userId');
    this.validateId(actorUserId, 'actorUserId');
    this.validateRole(role);

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL statement_timeout = $1', [30000]);

      // P1-19 FIX: Check actor has permission to assign this role
      await this.checkActorPermission(client, orgId, actorUserId, role);

      const result = await client.query(
        'UPDATE memberships SET role=$3, updated_at=NOW() WHERE user_id=$1 AND org_id=$2',
        [userId, orgId, role]
      );

      if (result.rowCount === 0) {
        throw new NotFoundError('Membership not found');
      }

      await client.query('COMMIT');
    } catch (error) {
      await this.safeRollback(client);
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
        // P1-FIX: PostgreSQL does NOT allow FOR UPDATE with aggregate functions.
        // The previous query `SELECT COUNT(*)::int ... FOR UPDATE` would throw:
        // "ERROR: FOR UPDATE is not allowed with aggregate functions", making the
        // last-owner protection completely non-functional (the transaction rolled
        // back on every removal attempt for an owner-role member).
        //
        // Fix: Find any *other* owner row and lock it to prevent concurrent removal.
        // If no other owner exists (rows empty), this is the last owner.
        const { rows: otherOwnerRows } = await client.query(
          'SELECT 1 FROM memberships WHERE org_id = $1 AND role = $2 AND user_id != $3 LIMIT 1 FOR UPDATE',
          [orgId, 'owner', userId]
        );
        if (otherOwnerRows.length === 0) {
          throw new ForbiddenError('Cannot remove the last owner of the organization');
        }
      }

      await client.query(
        'DELETE FROM memberships WHERE user_id=$1 AND org_id=$2',
        [userId, orgId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await this.safeRollback(client);
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
