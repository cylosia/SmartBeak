/**
 * Kernel Auth Package
 *
 * Authentication and authorization utilities for the kernel package.
 * P0-FIX: Created this file to resolve TS2307 errors from missing module.
 */

/**
 * Auth error types
 */
// AUDIT-FIX: Added REVOCATION_CHECK_FAILED, INVALID_TOKEN_ID, INVALID_USER_ID
// for proper error classification in revocation pipeline checks.
export type AuthErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'TOKEN_REVOKED'
  | 'MISSING_CLAIM'
  | 'INVALID_KEY'
  | 'REVOCATION_FAILED'
  | 'REVOCATION_CHECK_FAILED'
  | 'USER_REVOCATION_FAILED'
  | 'TOKEN_BINDING_ERROR'
  | 'INVALID_TOKEN_ID'
  | 'INVALID_USER_ID';

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
import { verifyToken as securityVerifyToken, type JwtClaims } from '../security/jwt';

// Re-export JwtClaims for consumers of this module.
export type { JwtClaims };

/**
 * Verify a JWT token synchronously.
 * Delegates to packages/security/jwt.ts which holds the real implementation.
 *
 * NOTE: This performs cryptographic verification only (signature, expiry, claims
 * schema). It does NOT check Redis revocation lists. For revocation-aware
 * verification, use control-plane/services/jwt.ts:verifyToken() instead.
 *
 * @param token - JWT token string
 * @param options - Verification options
 * @returns Zod-validated JWT claims
 * @throws {TokenInvalidError} When token is invalid or verification fails
 */
// AUDIT-FIX P2: Return type changed from `unknown` to `JwtClaims`. The previous
// `unknown` return erased all Zod-validated type safety from securityVerifyToken,
// forcing callers to re-validate or use unsafe casts.
export function verifyToken(token: string, options: VerifyTokenOptions = {}): JwtClaims {
  return securityVerifyToken(token, { audience: options.audience, issuer: options.issuer });
}
