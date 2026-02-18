
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
  // Use bracket notation to avoid property-access from prototype chain
  const r = req as Record<string, unknown>;
  return r['auth'] !== null && r['auth'] !== undefined && typeof r['auth'] === 'object';
}

/**
 * Replaces unsafe `(req as any).auth` pattern
 *
 * @param req - Fastify request object
 * @returns Auth context
 * @throws AuthError (401) if auth is not present — maps correctly to HTTP 401, not 500
 */
export function getAuthContext(req: FastifyRequest): AuthContext {
  if (!hasAuthContext(req)) {
    // FIXED (TYPES-4): Throw AuthError so Fastify's error handler returns 401 not 500
    throw new AuthError('Auth context not found', ErrorCodes['UNAUTHORIZED']);
  }
  const r = req as Record<string, unknown>;
  return r['auth'] as AuthContext;
}

/**
 * Returns null if auth is not present
 *
 * @param req - Fastify request object
 * @returns Auth context or null
 */
export function getOptionalAuthContext(req: FastifyRequest): AuthContext | null {
  if (!hasAuthContext(req)) return null;
  const r = req as Record<string, unknown>;
  return r['auth'] as AuthContext;
}
