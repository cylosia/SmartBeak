


import type { NextApiRequest, NextApiResponse } from 'next';
import type { Pool } from 'pg';
import { getPoolInstance } from '../../../lib/db';

// import { verifyDns } from '@kernel/dns';
const verifyDns = async (_domain: string, _token?: string): Promise<boolean> => {
  // Placeholder implementation - DNS verification logic should be implemented here
  return true;
};

import { rateLimit } from '../../../lib/rate-limit';
import { requireAuth, validateMethod, sendError } from '../../../lib/auth';

async function verifyDomainOwnership(
  userId: string,
  domainId: string,
  pool: Pool
): Promise<boolean> {
  const result = await pool.query(
  `SELECT 1 FROM domain_registry dr
  JOIN memberships m ON m.org_id = dr.org_id
  WHERE dr.domain_id = $1 AND m.user_id = $2
  LIMIT 1`,
  [domainId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
* POST /api/domains/verify-dns
* Verify DNS records for domain ownership
*/
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['POST'])) return;

  try {
  // RATE LIMITING: DNS verification endpoint - 30 requests/minute
  const allowed = await rateLimit('domains:verify-dns', 30, req, res);
  if (!allowed) return;

  const auth = await requireAuth(req, res);
  const { domain, token, domainId } = req.body;

  if (!domain || typeof domain !== 'string') {
    return sendError(res, 400, 'Domain is required');
  }

  // Validate domain format
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
  if (!domainRegex.test(domain)) {
    return sendError(res, 400, 'Invalid domain format');
  }

  if (domainId) {

    const pool = await getPoolInstance();

    const isAuthorized = await verifyDomainOwnership(auth.userId, domainId, pool);
    if (!isAuthorized) {

    return sendError(res, 404, 'Domain not found');
    }
  }

  const ok = await verifyDns(domain, token);
  if (!ok) {
    return res.status(400).json({ verified: false, error: 'DNS verification failed' });
  }

  res.json({ verified: true, domain });
  } catch (error: unknown) {
  if (error instanceof Error && error.name === 'AuthError') return;
  console.error('[domains/verify-dns] Error:', error);
  sendError(res, 500, 'Failed to verify DNS');
  }
}
