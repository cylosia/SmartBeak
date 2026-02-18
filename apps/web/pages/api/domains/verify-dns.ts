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

interface DomainOwnershipResult {
  isAuthorized: boolean;
  /** The domain name stored in the DB for this domainId, or null when not found. */
  registeredDomain: string | null;
}

/**
 * P1-FIX: Return the registered domain name alongside the authorization result.
 * Callers must compare the user-supplied domain against registeredDomain to
 * prevent the domain-identity decoupling attack where a user passes their own
 * domainId (ownership check passes) but a different domain in the body (gets
 * verified against DNS without ownership validation).
 */
async function verifyDomainOwnership(
  userId: string,
  domainId: string,
  pool: Pool
): Promise<DomainOwnershipResult> {
  const result = await pool.query(
    `SELECT dr.domain_name FROM domain_registry dr
     JOIN memberships m ON m.org_id = dr.org_id
     WHERE dr.domain_id = $1 AND m.user_id = $2
     LIMIT 1`,
    [domainId, userId]
  );
  if ((result.rowCount ?? 0) === 0) {
    return { isAuthorized: false, registeredDomain: null };
  }
  const row = result.rows[0] as { domain_name: string };
  return { isAuthorized: true, registeredDomain: row['domain_name'] };
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

  // P1-FIX: domainId is required — without it the ownership check is skipped entirely
  // and any authenticated user can verify any domain name without owning it.
  if (!domainId || typeof domainId !== 'string') {
    return sendError(res, 400, 'Domain ID is required');
  }

  // P1-2 FIX: Validate domainId as UUID before SQL query
  if (!isValidUUID(domainId)) {
    return sendError(res, 400, 'Invalid domain ID format');
  }

  const pool = await getPoolInstance();
  const { isAuthorized, registeredDomain } = await verifyDomainOwnership(auth.userId, domainId, pool);
  if (!isAuthorized) {
    return sendError(res, 404, 'Domain not found');
  }

  // P1-FIX: Reject if the user-supplied domain doesn't match the DB record for domainId.
  // Without this check, an attacker can pass their own domainId (ownership check passes)
  // and a different domain in the body — getting that foreign domain verified for free.
  if (domain !== registeredDomain) {
    return sendError(res, 403, 'Domain does not match registered domain');
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
