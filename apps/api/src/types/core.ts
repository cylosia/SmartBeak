/**
 * Core type definitions for the API
 */

import type { FastifyRequest } from 'fastify';

/**
 * Standard user claims for authenticated requests
 */
export interface UserClaims {
  id: string;
  orgId: string;
  stripeCustomerId?: string | undefined;
  [key: string]: unknown;
}

/**
 * Authenticated request type that extends FastifyRequest
 */
export type AuthenticatedRequest = FastifyRequest & {
  user: UserClaims;
};

/**
 * Request with optional user
 */
export type MaybeAuthenticatedRequest = FastifyRequest & {
  user?: UserClaims | undefined;
};

/**
 * Standard error response shape
 */
export interface ErrorResponse {
  error: string;
  code?: string | undefined;
  message?: string | undefined;
  details?: unknown;
}
