
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { getLogger } from '@kernel/logger';
import { ValidationError, ErrorCodes } from '@errors';
import type { Role } from './auth';

const logger = getLogger('OrgService');

/** Hard upper bound on the number of members returned per page. */
const MAX_MEMBERS_LIMIT = 200;

/** Maximum org name length — mirrors the Zod constraint in the orgs route. */
const MAX_ORG_NAME_LENGTH = 100;

interface MemberRow {
  user_id: string;
  // FIX (OS-02): Use a narrowed union instead of plain `string` to match the
  // memberships table CHECK constraint (role IN ('owner','admin','editor','viewer')).
  // `Exclude<Role, 'buyer'>` derives this automatically from the canonical Role
  // type in auth.ts, so any future additions to Role are reflected here.
  // The 'buyer' role is not assignable to membership rows per the DB constraint.
  role: Exclude<Role, 'buyer'>;
}

interface OrgRecord {
  id: string;
  name: string;
}

/**
 * Assert that orgId is a non-empty string.
 * Throws ValidationError (400) rather than letting the DB return a generic error.
 */
function assertOrgId(orgId: string): void {
  if (!orgId || typeof orgId !== 'string') {
    throw new ValidationError('Valid orgId is required', ErrorCodes.VALIDATION_ERROR);
  }
}

export class OrgService {
  constructor(private pool: Pool) {}

  async createOrg(name: string, ownerUserId: string): Promise<OrgRecord> {
  // FIX (OS-01): Validate inputs at service level — defense-in-depth since the
  // route layer also validates, but services may be called from other contexts.
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('Organization name is required', ErrorCodes.VALIDATION_ERROR);
  }
  if (name.length > MAX_ORG_NAME_LENGTH) {
    throw new ValidationError(
      `Organization name must be ${MAX_ORG_NAME_LENGTH} characters or less`,
      ErrorCodes.VALIDATION_ERROR
    );
  }
  if (!ownerUserId || typeof ownerUserId !== 'string') {
    throw new ValidationError('Valid ownerUserId is required', ErrorCodes.VALIDATION_ERROR);
  }

  const orgId = randomUUID();
  const client = await this.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

    await client.query('INSERT INTO organizations (id, name) VALUES ($1,$2)', [orgId, name]);
    await client.query(
    'INSERT INTO memberships (user_id, org_id, role) VALUES ($1,$2,$3)',
    [ownerUserId, orgId, 'owner']
    );

    await client.query('COMMIT');
    return { id: orgId, name };
  } catch (error) {
    // FIX (P2-rollback): Log ROLLBACK failures so operators can detect
    // transactions left open due to network errors.  Re-throw the original
    // error regardless so the caller sees the root cause.
    await client.query('ROLLBACK').catch((rbErr: unknown) => {
      logger.error(
        'OrgService.createOrg: ROLLBACK failed',
        rbErr instanceof Error ? rbErr : new Error(String(rbErr)),
        { orgId }
      );
    });
    throw error;
  } finally {
    client.release();
  }
  }

  async listMembers(orgId: string, limit = 50, offset = 0): Promise<MemberRow[]> {
  // FIX (OS-01): Validate orgId before hitting the DB.
  assertOrgId(orgId);
  // FIX (P2-bounds): Enforce hard bounds so callers (or callers of callers)
  // cannot trigger full-table scans by passing unbounded limit/offset values.
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), MAX_MEMBERS_LIMIT);
  const safeOffset = Math.max(0, Math.floor(offset));

  // Bounded result set prevents OOM for large orgs.
  // Callers paginate by incrementing offset in steps of limit.
  const { rows } = await this.pool.query(
    'SELECT user_id, role FROM memberships WHERE org_id=$1 ORDER BY user_id ASC LIMIT $2 OFFSET $3',
    [orgId, safeLimit, safeOffset]
  );
  return rows;
  }
}
