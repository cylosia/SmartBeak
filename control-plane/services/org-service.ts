
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

export interface MemberRow {
  user_id: string;
  role: string;
}

export interface ListMembersResult {
  data: MemberRow[];
  nextCursor: string | null;
}

export class OrgService {
  constructor(private pool: Pool) {}

  async createOrg(name: string, ownerUserId: string): Promise<{ id: string; name: string }> {
    const orgId = randomUUID();
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL statement_timeout = $1', [30000]);

      await client.query('INSERT INTO organizations (id, name) VALUES ($1,$2)', [orgId, name]);
      await client.query(
        'INSERT INTO memberships (user_id, org_id, role) VALUES ($1,$2,$3)',
        [ownerUserId, orgId, 'owner']
      );

      await client.query('COMMIT');
      return { id: orgId, name };
    } catch (error) {
      // P1-7: Wrap ROLLBACK in its own try/catch so a connection failure during
      // ROLLBACK does not replace the original exception (e.g. constraint violation)
      // with a misleading "connection terminated" error.
      try { await client.query('ROLLBACK'); }
      catch (rbErr) {
        // Log but swallow the ROLLBACK error — the original error is more useful.
        const e = rbErr instanceof Error ? rbErr : new Error(String(rbErr));
        // Use console.error here only as last resort; pool may be torn down.
        // eslint-disable-next-line no-console
        console.error('[org-service] ROLLBACK failed:', e.message);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  // P2-5: Add cursor-based pagination to prevent full-table reads on large orgs.
  async listMembers(orgId: string, limit = 100, afterUserId?: string): Promise<ListMembersResult> {
    const params: unknown[] = [orgId, limit + 1]; // fetch one extra to determine nextCursor
    let query = 'SELECT user_id, role FROM memberships WHERE org_id = $1';
    if (afterUserId) {
      params.push(afterUserId);
      query += ` AND user_id > $${params.length}`;
    }
    query += ` ORDER BY user_id ASC LIMIT $2`;

    const { rows } = await this.pool.query<MemberRow>(query, params);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = data[data.length - 1];
    const nextCursor = hasMore && lastRow ? lastRow.user_id : null;

    return { data, nextCursor };
  }
}
