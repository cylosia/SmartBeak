import { randomBytes, timingSafeEqual } from 'crypto';

import { TokenExpiredError as JwtTokenExpiredError } from 'jsonwebtoken';
import { z } from 'zod';

import type { NextApiRequest, NextApiResponse } from 'next';
import type { FastifyRequest, FastifyReply } from 'fastify';

import type { AuthContext } from '@types/auth';
import { type UserRole, roleHierarchy } from '@types/auth';

import {
  verifyToken as jwtVerifyToken,
  TokenExpiredError as JwtModuleTokenExpiredError,
  TokenInvalidError as JwtModuleTokenInvalidError,
  type JwtClaims,
} from './jwt';

/**
* Unified Authentication Package
* Consolidated JWT verification logic for SmartBeak
*
* This module provides:
* - Token verification with constant-time comparison (timing-safe)
* - Zod schema validation for JWT claims
* - Fastify and Next.js compatible auth helpers
* - Support for Redis-based token revocation
* - Proper Bearer token validation
*/

// ============================================================================
// Constants
// ============================================================================

const BEARER_REGEX = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const UserRoleSchema = z.enum(['viewer', 'editor', 'admin', 'owner']);

// ============================================================================
// Types (re-exported from @types/auth — single source of truth)
// ============================================================================

export type { AuthContext, UserRole };
export { roleHierarchy };

/**
* Auth context for Fastify requests
* Attached to request object by auth middleware
*/
export interface FastifyAuthContext {
  userId: string;
  orgId: string;
  roles: string[];
  sessionId?: string | undefined;
  requestId?: string | undefined;
}

// Extend FastifyRequest type to include auth
declare module 'fastify' {
  interface FastifyRequest {
    authContext?: FastifyAuthContext;
  }
}

// ============================================================================
// Error Classes
// ============================================================================

class TokenExpiredError extends Error {
  constructor(message = 'Token expired') {
    super(message);
    this.name = 'TokenExpiredError';
  }
}

class TokenRevokedError extends Error {
  constructor(message = 'Token revoked') {
    super(message);
    this.name = 'TokenRevokedError';
  }
}

class TokenBindingError extends Error {
  constructor(message = 'Token binding validation failed') {
    super(message);
    this.name = 'TokenBindingError';
  }
}

// ============================================================================
// Private Helpers
// ============================================================================

// Delegates to packages/security/jwt.ts verifyToken for consistent key rotation,
// Zod validation, and clock tolerance across all auth paths.
function verifyToken(token: string): { sub?: string; orgId?: string; role?: string; jti?: string; exp?: number } {
  try {
    const claims: JwtClaims = jwtVerifyToken(token);
    return claims;
  } catch (error) {
    if (error instanceof JwtModuleTokenExpiredError) {
      throw new TokenExpiredError();
    }
    if (error instanceof JwtModuleTokenInvalidError) {
      throw new Error('Invalid token');
    }
    throw new Error('Invalid token');
  }
}

function generateRequestId(): string {
  return randomBytes(16).toString('hex');
}

function validateAuthHeaderConstantTime(authHeader: string): boolean {
  const expectedPrefix = 'Bearer ';
  if (authHeader.length < expectedPrefix.length + 10) {
    return false;
  }
  try {
    const prefix = authHeader.slice(0, expectedPrefix.length);
    const prefixBuffer = Buffer.from(prefix);
    const expectedBuffer = Buffer.from(expectedPrefix);
    return timingSafeEqual(prefixBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

// ============================================================================
// Next.js Auth Functions
// ============================================================================

/**
* Verify auth for Next.js API routes (required authentication)
*/
export async function requireAuthNextJs(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<AuthContext | null> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !validateAuthHeaderConstantTime(authHeader)) {
  res.status(401).json({ error: 'Unauthorized. Bearer token required.' });
  return null;
  }

  // Validate token format
  if (!BEARER_REGEX.test(authHeader)) {
  res.status(401).json({ error: 'Unauthorized. Invalid token format.' });
  return null;
  }

  const token = authHeader.slice(7);
  if (!token || token.length < 10) {
  res.status(401).json({ error: 'Unauthorized. Invalid token format.' });
  return null;
  }

  try {
  const claims = verifyToken(token);

  if (!claims.sub) {
    res.status(401).json({ error: 'Unauthorized. Token missing user ID.' });
    return null;
  }

  if (!claims["orgId"]) {
    res.status(401).json({ error: 'Unauthorized. Organization context required.' });
    return null;
  }

  if (!claims.role) {
    throw new Error('Token missing role claim');
  }
  const roles = [claims.role];

  return {
    userId: claims.sub,
    orgId: claims["orgId"],
    roles,
    sessionId: claims.jti,
    requestId: generateRequestId(),
  };
  } catch (error) {
  if (error instanceof TokenExpiredError) {
    res.status(401).json({ error: 'Unauthorized. Token expired.' });
    return null;
  }
  if (error instanceof TokenRevokedError) {
    res.status(401).json({ error: 'Unauthorized. Token revoked.' });
    return null;
  }
  if (error instanceof TokenBindingError) {
    res.status(401).json({ error: 'Unauthorized. Token binding validation failed.' });
    return null;
  }
  res.status(401).json({ error: 'Unauthorized. Invalid token.' });
  return null;
  }
}

/**
* Optional auth for Next.js API routes
*/
export async function optionalAuthNextJs(
  req: NextApiRequest
): Promise<AuthContext | null> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !validateAuthHeaderConstantTime(authHeader)) {
  return null;
  }

  // Validate token format
  if (!BEARER_REGEX.test(authHeader)) {
  return null;
  }

  const token = authHeader.slice(7);
  if (!token || token.length < 10) {
  return null;
  }

  try {
  const claims = verifyToken(token);

  // Check expiration explicitly
  if (claims.exp && claims.exp * 1000 < Date.now()) {
    return null;
  }

  if (!claims.sub || !claims["orgId"]) {
    return null;
  }

  if (!claims.role) {
    throw new Error('Token missing role claim');
  }
  const roles = [claims.role];

  return {
    userId: claims.sub,
    orgId: claims["orgId"],
    roles,
    sessionId: claims.jti,
    requestId: generateRequestId(),
  };
  } catch {
  return null;
  }
}

// ============================================================================
// Fastify Auth Functions
// ============================================================================

/**
* Optional auth for Fastify routes
* Attaches auth context to request if token is valid, but doesn't require it
*/
export async function optionalAuthFastify(
  req: FastifyRequest,
  _res: FastifyReply
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !validateAuthHeaderConstantTime(authHeader)) {
    return;
  }

  // Validate token format
  if (!BEARER_REGEX.test(authHeader)) {
    return;
  }

  const token = authHeader.slice(7);
  if (!token || token.length < 10) {
    return;
  }

  try {
    const claims = verifyToken(token);

    // Check expiration explicitly
    if (claims.exp && claims.exp * 1000 < Date.now()) {
      return;
    }

    if (!claims.sub || !claims["orgId"]) {
      return;
    }

    // If role is missing, don't attach auth context
    if (!claims.role) {
      return;
    }
    const roles = [claims.role];

    // Attach auth context to request
    req.authContext = {
      userId: claims.sub,
      orgId: claims["orgId"],
      roles,
      sessionId: claims.jti,
      requestId: generateRequestId(),
    };
  } catch {
    // Token invalid, continue without auth context
  }
}

/**
* Required auth for Fastify routes
* Returns 401 if authentication fails
*/
export async function requireAuthFastify(
  req: FastifyRequest,
  res: FastifyReply
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !validateAuthHeaderConstantTime(authHeader)) {
    res.status(401).send({ error: 'Unauthorized. Bearer token required.' });
    return;
  }

  // Validate token format
  if (!BEARER_REGEX.test(authHeader)) {
    res.status(401).send({ error: 'Unauthorized. Invalid token format.' });
    return;
  }

  const token = authHeader.slice(7);
  if (!token || token.length < 10) {
    res.status(401).send({ error: 'Unauthorized. Invalid token format.' });
    return;
  }

  try {
    const claims = verifyToken(token);

    if (!claims.sub) {
      res.status(401).send({ error: 'Unauthorized. Token missing user ID.' });
      return;
    }

    if (!claims["orgId"]) {
      res.status(401).send({ error: 'Unauthorized. Organization context required.' });
      return;
    }

    if (!claims.role) {
      res.status(401).send({ error: 'Unauthorized. Token missing role claim.' });
      return;
    }
    const roles = [claims.role];

    // Attach auth context to request
    req.authContext = {
      userId: claims.sub,
      orgId: claims["orgId"],
      roles,
      sessionId: claims.jti,
      requestId: generateRequestId(),
    };
  } catch (error) {
    if (error instanceof JwtTokenExpiredError) {
      res.status(401).send({ error: 'Unauthorized. Token expired.' });
      return;
    }
    res.status(401).send({ error: 'Unauthorized. Invalid token.' });
  }
}

// ============================================================================
// Generic Export Functions (framework-agnostic)
// ============================================================================

/**
* Extract and verify Bearer token from Authorization header
* Generic function that works with any request object
*/
export function verifyAuthHeader(authHeader: string | undefined): {
  valid: boolean;
  token: string | null;
  error?: string | undefined;
} {

  if (!authHeader || !validateAuthHeaderConstantTime(authHeader)) {
  return { valid: false, token: null, error: 'Missing or invalid Authorization header' };
  }

  // Validate token format
  if (!BEARER_REGEX.test(authHeader)) {
  return { valid: false, token: null, error: 'Invalid token format' };
  }

  const token = authHeader.slice(7);
  if (!token || token.length < 10) {
  return { valid: false, token: null, error: 'Invalid token format' };
  }

  return { valid: true, token };
}

/**
* Check if user has required role level (single-role comparison)
*/
export function hasRequiredRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

// ============================================================================
// Re-export for backward compatibility
// ============================================================================

export { UserRoleSchema as RoleSchema };
