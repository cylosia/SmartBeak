
import type { NextApiRequest, NextApiResponse } from 'next';

import { requireAuth, validateMethod, sendError } from '../../../lib/auth';
import { getPoolInstance } from '../../../lib/db';
import { rateLimit } from '../../../lib/rate-limit';
import { getLogger } from '@kernel/logger';
async function verifyDomainOwnership(userId: string, domainId: string, orgId: string): Promise<boolean> {
  const pool = await getPoolInstance();
  const { rows } = await pool.query(
    `SELECT 1 FROM domain_registry dr
     JOIN memberships m ON m.org_id = dr.org_id
     WHERE dr.domain_id = $1 AND m.user_id = $2 AND dr.org_id = $3`,
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
  // RATE LIMITING: Read endpoint - 50 requests/minute
  const allowed = await rateLimit('diligence:links', 50, req, res);
  if (!allowed) return;

  const auth = await requireAuth(req, res);
  const { domainId } = req.query;

  if (!domainId || typeof domainId !== 'string') {
    return res.status(400).json({ error: 'Domain ID required' });
  }

  const isAuthorized = await verifyDomainOwnership(auth.userId, domainId, auth["orgId"]);
  if (!isAuthorized) {
    // SECURITY: Return 404 (not 403) to prevent ID enumeration
    getLogger('diligence').warn('IDOR attempt on diligence links', { domainId });
    return res.status(404).json({ error: 'Domain not found' });
  }

  // P0-FIX: Query actual database for link statistics instead of mock data
  const pool = await getPoolInstance();
  const client = await pool.connect();
  try {
    // P1-FIX: Wrap both queries in a transaction for consistent statistics
    await client.query('BEGIN');

    // Get internal link statistics.
    // Orphan detection is scoped to the domain: a page is an orphan only when
    // no internal link from another page *within the same domain* targets it.
    // CTE-based rewrite eliminates the prior correlated subquery that scanned
    // the full links table once per page row (O(pages * links) → O(pages + links)).
    // The link_count subquery is also domain-scoped to avoid cross-domain skew.
    const internalStats = await client.query(`
      WITH domain_pages AS (
        SELECT id FROM pages WHERE domain_id = $1
      ),
      internal_targets AS (
        SELECT DISTINCT l2.target_id
        FROM links l2
        WHERE l2.source_id IN (SELECT id FROM domain_pages)
          AND l2.is_external = false
      ),
      domain_link_counts AS (
        SELECT source_id, COUNT(*) AS link_count
        FROM links
        WHERE source_id IN (SELECT id FROM domain_pages)
        GROUP BY source_id
      )
      SELECT
        COUNT(DISTINCT p.id) AS total_pages,
        COUNT(DISTINCT CASE WHEN it.target_id IS NULL THEN p.id END) AS orphan_pages,
        COUNT(DISTINCT CASE WHEN l.broken = true THEN l.id END) AS broken_links,
        COALESCE(AVG(dlc.link_count), 0) AS avg_links_per_page
      FROM pages p
      LEFT JOIN links l ON l.source_id = p.id
      LEFT JOIN internal_targets it ON it.target_id = p.id
      LEFT JOIN domain_link_counts dlc ON dlc.source_id = p.id
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

    // P1-FIX: Get actual last crawl timestamp instead of fabricating it
    const crawlTimestamp = await client.query(
      `SELECT MAX(crawled_at) as last_crawled FROM pages WHERE domain_id = $1`,
      [domainId]
    );

    await client.query('COMMIT');

    const linkSummary = {
    internal: {
      orphan_pages: parseInt(internalStats.rows[0]?.orphan_pages || '0', 10),
      broken_links: parseInt(internalStats.rows[0]?.broken_links || '0', 10),
      total_pages: parseInt(internalStats.rows[0]?.total_pages || '0', 10),
      avg_links_per_page: Math.round(parseFloat(internalStats.rows[0]?.avg_links_per_page || '0'))
    },
    external: {
      affiliate_links: parseInt(externalStats.rows[0]?.affiliate_links || '0', 10),
      broken_links: parseInt(externalStats.rows[0]?.broken_links || '0', 10),
      total_external: parseInt(externalStats.rows[0]?.total_external || '0', 10),
      domains_linked: parseInt(externalStats.rows[0]?.domains_linked || '0', 10)
    },
    lastCrawled: crawlTimestamp.rows[0]?.last_crawled || null
    };

    res.json(linkSummary);
  } catch (queryError: unknown) {
    await client.query('ROLLBACK').catch((rbErr: unknown) => {
      getLogger('diligence:links').error('ROLLBACK failed', rbErr instanceof Error ? rbErr : undefined);
    });
    throw queryError;
  } finally {
    client.release();
  }
  } catch (error: unknown) {
  if (error instanceof Error && error.name === 'AuthError') return;
  getLogger('diligence:links').error('Error fetching link summary', error instanceof Error ? error : undefined);
  sendError(res, 500, 'Failed to fetch link summary');
  }
}
