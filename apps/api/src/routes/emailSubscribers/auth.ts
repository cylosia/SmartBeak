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
  // P1-2 FIX: Remove try/catch — let DB errors propagate as 5xx, not silent 403.
  // Previously a transient DB failure returned false → HTTP 403, masking the real outage.
  // P1-SQL FIX: Add .timeout(10000) — without a timeout, a slow or hung join holds the
  // connection indefinitely, exhausting the pool and cascading to all subscriber routes.
  const db = getDb();
  const row = await db('domain_registry')
    .join('memberships', 'memberships.org_id', 'domain_registry.org_id')
    .where('domain_registry.domain_id', domainId)
    .where('memberships.user_id', userId)
    .where('domain_registry.org_id', orgId)
    .select('memberships.role')
    .timeout(10000)
    .first();
  return !!row;
}
