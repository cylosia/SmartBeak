import type { NextApiRequest, NextApiResponse } from 'next';
import type { Pool } from 'pg';
import { getPoolInstance } from '../../../lib/db';

// P0-1 FIX: Use real DNS verification instead of stub that always returns true
import { verifyDns } from '@kernel/dns';

import { rateLimit } from '../../../lib/rate-limit';
import { requireAuth, validateMethod, sendError, AuthError } from '../../../lib/auth';
import { isValidUUID } from '@security/input-validator';
import { getLogger } from '@kernel/logger';

const logger = getLogger('domains/verify-dns');

// P2-10 FIX: RFC-compliant domain validation — validates labels separately to avoid ReDoS
function isValidDomainLabel(l: string): boolean {
  return l.length >= 1 && l.length <= 63
    && /^[a-zA-Z0-9]/.test(l) && /[a-zA-Z0-9]$/.test(l)
    && /^[a-zA-Z0-9-]+$/.test(l);
}
function isValidDomain(domain: string): boolean {
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  const tld = labels[labels.length - 1]!;
  return /^[a-zA-Z]{2,}$/.test(tld) && labels.every(isValidDomainLabel);
}
const MAX_DOMAIN_LENGTH = 253;

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

  // P2-10 FIX: Use RFC-compliant domain validation
  if (domain.length > MAX_DOMAIN_LENGTH || !isValidDomain(domain)) {
    return sendError(res, 400, 'Invalid domain format');
  }

  // P1-1 FIX: Validate token parameter before passing to DNS verifier
  if (token !== undefined && (typeof token !== 'string' || token.length > 256)) {
    return sendError(res, 400, 'Invalid verification token');
  }

  // P1-2 FIX: Validate domainId as UUID before SQL query
  if (domainId !== undefined && !isValidUUID(domainId)) {
    return sendError(res, 400, 'Invalid domain ID format');
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

  logger.info('DNS verification succeeded', { domain, userId: auth.userId });
  res.json({ verified: true, domain });
  } catch (error: unknown) {
  // P1-3 FIX: Use instanceof for AuthError check instead of brittle name comparison
  if (error instanceof AuthError) return;
  logger.error('DNS verification failed', error instanceof Error ? error : new Error(String(error)));
  sendError(res, 500, 'Failed to verify DNS');
  }
}
