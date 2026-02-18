
import type { NextApiRequest, NextApiResponse } from 'next';
import type { PoolClient } from 'pg';

import { requireAuth, validateMethod, sendError } from '../../../lib/auth';
import { getPoolInstance } from '../../../lib/db';
import { rateLimit } from '../../../lib/rate-limit';
import { getLogger } from '@kernel/logger';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function verifyDomainOwnership(client: PoolClient, userId: string, domainId: string, orgId: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM domain_registry dr
     JOIN memberships m ON m.org_id = dr.org_id
     WHERE dr.domain_id = $1 AND m.user_id = $2 AND dr.org_id = $3
       AND m.status = 'active'
       AND m.role IN ('owner', 'admin', 'editor')`,
    [domainId, userId, orgId]
  );
  return rows.length > 0;
}

/**
* GET /api/diligence/links
* Return buyer-safe linking summary (no actual URLs for security)
*/
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['GET'])) return;

  try {
  // Authenticate first, then rate limit with user context
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const allowed = await rateLimit(`diligence:links:${auth.userId}`, 50, req, res);
  if (!allowed) return;

  const { domainId } = req.query;

  if (!domainId || typeof domainId !== 'string' || !UUID_PATTERN.test(domainId)) {
    return res.status(400).json({ error: 'Valid domain ID required' });
  }

  const pool = await getPoolInstance();
  const client = await pool.connect();
  try {
    // Use same client for ownership check and queries to avoid double connection checkout
    const isAuthorized = await verifyDomainOwnership(client, auth.userId, domainId, auth["orgId"]);
    if (!isAuthorized) {
      // SECURITY: Return 404 (not 403) to prevent ID enumeration
      getLogger('diligence').warn('IDOR attempt on diligence links', {
        domainId,
        userId: auth.userId,
        orgId: auth["orgId"],
      });
      return res.status(404).json({ error: 'Domain not found' });
    }

    // Use REPEATABLE READ for consistent snapshot across all queries
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

    // Get internal link statistics — rewritten to avoid correlated subquery
    const internalStats = await client.query(`
      SELECT
      COUNT(DISTINCT p.id) as total_pages,
      COUNT(DISTINCT CASE WHEN l.source_id IS NULL THEN p.id END) as orphan_pages,
      COUNT(DISTINCT CASE WHEN l.broken = true THEN l.id END) as broken_links,
      COALESCE(AVG(link_counts.link_count), 0) as avg_links_per_page
    FROM pages p
    LEFT JOIN links l ON l.source_id = p.id
    LEFT JOIN (
      SELECT source_id, COUNT(*) as link_count
      FROM links
      GROUP BY source_id
    ) link_counts ON link_counts.source_id = p.id
    WHERE p.domain_id = $1
    `, [domainId]);

    // Get external link statistics
    const externalStats = await client.query(`
      SELECT COUNT(*) as total_external,
      COUNT(DISTINCT CASE WHEN l.broken = true THEN l.id END) as broken_links,
      COUNT(DISTINCT CASE WHEN l.rel = 'affiliate' THEN l.id END) as affiliate_links,
      COUNT(DISTINCT l.target_domain) as domains_linked
    FROM links l
    JOIN pages p ON l.source_id = p.id
    WHERE p.domain_id = $1 AND l.is_external = true
    `, [domainId]);

    const crawlTimestamp = await client.query(
      `SELECT MAX(crawled_at) as last_crawled FROM pages WHERE domain_id = $1`,
      [domainId]
    );

    await client.query('COMMIT');

    const internalRow = internalStats.rows[0];
    const externalRow = externalStats.rows[0];

    const linkSummary = {
    internal: {
      orphan_pages: parseInt(internalRow?.orphan_pages || '0', 10),
      broken_links: parseInt(internalRow?.broken_links || '0', 10),
      total_pages: parseInt(internalRow?.total_pages || '0', 10),
      avg_links_per_page: Math.round(parseFloat(internalRow?.avg_links_per_page || '0'))
    },
    external: {
      affiliate_links: parseInt(externalRow?.affiliate_links || '0', 10),
      broken_links: parseInt(externalRow?.broken_links || '0', 10),
      total_external: parseInt(externalRow?.total_external || '0', 10),
      domains_linked: parseInt(externalRow?.domains_linked || '0', 10)
    },
    lastCrawled: crawlTimestamp.rows[0]?.last_crawled || null
    };

    res.json(linkSummary);
  } catch (queryErr) {
    await client.query('ROLLBACK').catch(rollbackErr => {
      getLogger('diligence:links').error('Rollback failed', rollbackErr instanceof Error ? rollbackErr : undefined);
    });
    throw queryErr;
  } finally {
    client.release();
  }
  } catch (error: unknown) {
  if (error instanceof Error && error.name === 'AuthError') return;
  getLogger('diligence:links').error('Error fetching link summary', error instanceof Error ? error : undefined, { error: String(error) });
  sendError(res, 500, 'Failed to fetch link summary');
  }
}
