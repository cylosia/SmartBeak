import type { AuthContext, FastifyRequestLike } from './types';
import { extractAndVerifyToken } from '@security/jwt';
import { getDb } from '../../db';
import { getLogger } from '@kernel/logger';

/**
* Authentication Module for Email Subscribers
* P1-SECURITY FIX: Use centralized @security/jwt instead of raw jwt.verify
* This ensures key rotation, timing-safe comparison, and consistent clockTolerance
*/

const logger = getLogger('EmailSubscriberAuth');


/**
* Verify JWT token from request headers
* @param req - Fastify request-like object
* @returns Auth context or null if invalid
*/
export async function authenticate(req: FastifyRequestLike): Promise<AuthContext | null> {
  return verifyAuth(req);
}

export async function requireAuth(req: FastifyRequestLike): Promise<AuthContext | null> {
  const auth = await verifyAuth(req);
  if (!auth) {
    throw new Error('Unauthorized');
  }
  return auth;
}

// P1-SECURITY FIX: Use centralized extractAndVerifyToken from @security/jwt
// instead of raw jwt.verify — ensures key rotation, clockTolerance, and timing-safe checks
export async function verifyAuth(req: FastifyRequestLike): Promise<AuthContext | null> {
  const authHeader = req.headers.authorization;
  const result = extractAndVerifyToken(authHeader);

  if (!result.valid || !result.claims) {
    return null;
  }

  const claims = result.claims;

  if (!claims.sub || !claims.orgId) {
    return null;
  }

  return { userId: claims.sub, orgId: claims.orgId };
}

/**
* Check if user can access a specific domain
* @param userId - User ID
* @param domainId - Domain ID to check
* @param orgId - Organization ID
* @returns True if user has access
*/
export async function canAccessDomain(
  userId: string,
  domainId: string,
  orgId: string
): Promise<boolean> {
  // P1-FIX: Remove try/catch — DB errors must propagate as 5xx, not be silently
  // converted to false (→ HTTP 403). A transient DB failure masquerading as
  // "Access Denied" misleads operators and suppresses 5xx alerts.
  // P1-FIX: Add .timeout(10000) consistent with emailSubscribers/index.ts.
  const db = await getDb();
  const rows = await db('domain_registry')
    .join('memberships', 'memberships.org_id', 'domain_registry.org_id')
    .where('domain_registry.domain_id', domainId)
    .where('memberships.user_id', userId)
    .where('domain_registry.org_id', orgId)
    .select('memberships.role')
    .timeout(10000)
    .first();

  return !!rows;
}
