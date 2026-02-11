import jwt from 'jsonwebtoken';

import type { AuthContext, FastifyRequestLike } from './types';
import { getDb } from '../../db';
import { getLogger } from '../../../../../packages/kernel/logger';

/**
* Authentication Module for Email Subscribers
* P2-MEDIUM FIX: Extracted from emailSubscribers.ts God class
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

export async function verifyAuth(req: FastifyRequestLike): Promise<AuthContext | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  try {
    const jwtKey = process.env['JWT_KEY_1'];
    if (!jwtKey) {
    logger.error('JWT_KEY_1 not configured');
    return null;
    }

    const claims = jwt.verify(token, jwtKey, {
    audience: process.env['JWT_AUDIENCE'] || 'smartbeak',
    issuer: process.env['JWT_ISSUER'] || 'smartbeak-api',
    algorithms: ['HS256'],
    }) as { sub: string; orgId: string };

    if (!claims.sub || !claims.orgId) {
    return null;
    }

    return { userId: claims.sub, orgId: claims.orgId };
  } catch (err) {
    return null;
  }
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
  try {
    const db = await getDb();
    const rows = await db('domain_registry')
    .join('memberships', 'memberships.org_id', 'domain_registry.org_id')
    .where('domain_registry.domain_id', domainId)
    .where('memberships.user_id', userId)
    .where('domain_registry.org_id', orgId)
    .select('memberships.role')
    .first();

    return !!rows;
  } catch (error) {
    // P2-MEDIUM FIX: error: unknown with proper type guard
    const errorMessage = error instanceof Error ? error["message"] : 'Unknown error';
    logger.error('Error checking domain access:', errorMessage);
    return false;
  }
}
