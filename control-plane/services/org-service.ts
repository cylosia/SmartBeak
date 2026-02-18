
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { getLogger } from '@kernel/logger';

const logger = getLogger('OrgService');

/** Hard upper bound on the number of members returned per page. */
const MAX_MEMBERS_LIMIT = 200;

export class OrgService {
  constructor(private pool: Pool) {}

  async createOrg(name: string, ownerUserId: string) {
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

  async listMembers(orgId: string, limit = 50, offset = 0) {
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
