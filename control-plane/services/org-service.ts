
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

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
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  }

  async listMembers(orgId: string, limit = 100, offset = 0) {
  // Bounded result set prevents OOM for large orgs.
  // Callers paginate by incrementing offset in steps of limit.
  const { rows } = await this.pool.query(
    'SELECT user_id, role FROM memberships WHERE org_id=$1 ORDER BY user_id ASC LIMIT $2 OFFSET $3',
    [orgId, limit, offset]
  );
  return rows;
  }
}
