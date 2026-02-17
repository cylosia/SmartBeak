
import { FastifyRequest } from 'fastify';
import type { AuthContext } from '../services/auth';
import { AuthError, ErrorCodes } from '@errors';

// Re-export AuthContext and Role from auth service to ensure consistency
export type { AuthContext, Role } from '../services/auth';

/**
* Authenticated request interface with proper typing
* Use this instead of `(req as any).auth`
*/
export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

/**
* Type guard to check if request has auth context
* @param req - Fastify request object
* @returns True if request has auth context
*/
export function hasAuthContext(req: FastifyRequest): req is AuthenticatedRequest {
  return 'auth' in req && req.auth !== null && req.auth !== undefined;
}

/**
* Replaces unsafe `(req as any).auth` pattern
*
* @param req - Fastify request object
* @returns Auth context
* @throws AuthError if auth is not present
*/
export function getAuthContext(req: FastifyRequest): AuthContext {
  if (!hasAuthContext(req)) {
    throw new AuthError('Auth context not found', ErrorCodes.UNAUTHORIZED);
  }
  return req.auth as AuthContext;
}

/**
* Returns null if auth is not present
*
* @param req - Fastify request object
* @returns Auth context or null
*/
export function getOptionalAuthContext(req: FastifyRequest): AuthContext | null {
  return hasAuthContext(req) ? (req.auth as AuthContext) : null;
}
