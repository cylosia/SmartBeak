/**
 * Kernel Auth Package
 *
 * Authentication and authorization utilities for the kernel package.
 * P0-FIX: Created this file to resolve TS2307 errors from missing module.
 */

/**
 * Auth error types
 */
export type AuthErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'TOKEN_REVOKED'
  | 'MISSING_CLAIM'
  | 'INVALID_KEY'
  | 'REVOCATION_FAILED'
  | 'USER_REVOCATION_FAILED'
  | 'TOKEN_BINDING_ERROR';

/**
 * Auth error class
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(message: string, code: AuthErrorCode = 'UNAUTHORIZED') {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/**
 * Token revoked error
 */
export class TokenRevokedError extends AuthError {
  constructor(message = 'Token has been revoked') {
    super(message, 'TOKEN_REVOKED');
    this.name = 'TokenRevokedError';
  }
}

/**
 * Token invalid error
 */
export class TokenInvalidError extends AuthError {
  constructor(message = 'Token is invalid') {
    super(message, 'TOKEN_INVALID');
    this.name = 'TokenInvalidError';
  }
}

/**
 * Token expired error
 */
export class TokenExpiredError extends AuthError {
  constructor(message = 'Token has expired') {
    super(message, 'TOKEN_EXPIRED');
    this.name = 'TokenExpiredError';
  }
}

/**
 * Missing claim error
 */
export class MissingClaimError extends AuthError {
  constructor(message = 'Required claim is missing') {
    super(message, 'MISSING_CLAIM');
    this.name = 'MissingClaimError';
  }
}

/**
 * Token binding error
 */
export class TokenBindingError extends AuthError {
  constructor(message = 'Token binding check failed') {
    super(message, 'TOKEN_BINDING_ERROR');
    this.name = 'TokenBindingError';
  }
}

/**
 * Verify token options
 */
export interface VerifyTokenOptions {
  audience?: string;
  issuer?: string;
  // F29-FIX: Removed ignoreExpiration - expired tokens must always be rejected
}

// Delegate to the real implementation in packages/security/jwt.ts.
// Static import is safe: security/jwt only imports @kernel/logger, no circular dep.
import { verifyToken as securityVerifyToken } from '../security/jwt';

/**
 * Verify a JWT token synchronously.
 * Delegates to packages/security/jwt.ts which holds the real implementation.
 *
 * @param token - JWT token string
 * @param options - Verification options
 * @returns Decoded claims
 * @throws {TokenInvalidError} When token is invalid or verification fails
 */
export function verifyToken(token: string, options: VerifyTokenOptions = {}): unknown {
  return securityVerifyToken(token, { audience: options.audience, issuer: options.issuer });
}
