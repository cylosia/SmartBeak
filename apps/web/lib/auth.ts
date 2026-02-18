import jwt from 'jsonwebtoken';
import crypto, { randomBytes } from 'crypto';
import { registerShutdownHandler, setupShutdownHandlers } from './shutdown';
import { getLogger } from '@kernel/logger';
// import type { AuthContext, UserRole } from '@security/jwt';
// SECURITY FIX: Add 'owner' role which exists in DB (CHECK role IN ('owner','admin','editor','viewer'))
// but was missing from TypeScript types, causing mapRole() to throw 500 for org owners
export type UserRole = 'owner' | 'admin' | 'editor' | 'viewer';
export interface AuthContext {
  userId: string;
  orgId: string;
  roles: UserRole[];
  sessionId?: string;
  requestId: string;
}
import { Pool } from 'pg';
import type { NextApiRequest, NextApiResponse, GetServerSidePropsContext } from 'next';
import { getAuth } from '@clerk/nextjs/server';
import { getPoolInstance } from './db';

const logger = getLogger('Auth');

/**
 * Authentication utilities for API routes
 * Uses Clerk for session-based authentication with JWT verification
 *
 * Note: This auth context is unified with control-plane/services/auth.ts
 * to ensure consistency across the application.
 */
// JWT verification - duplicated here to avoid cross-boundary import
// In production, this should be in a shared package
/**
 * Validate IP address format (IPv4 or IPv6)
 * SECURITY FIX: Basic IP validation to prevent IP spoofing
 * @param ip - IP address to validate
 * @returns True if IP is valid
 */
function isValidIP(ip: string): boolean {
  if (!ip || ip === 'unknown') {
    return false;
  }
  // Validate IPv4 by splitting octets — avoids nested quantifiers (ReDoS)
  const ipv4Parts = ip.split('.');
  if (ipv4Parts.length === 4) {
    return ipv4Parts.every(part => {
      if (!/^\d{1,3}$/.test(part)) return false;
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }
  // Validate IPv6 (simplified) — split on colons to avoid nested quantifiers
  if (ip === '::1' || ip === '::') return true;
  const ipv6Parts = ip.split(':');
  if (ipv6Parts.length === 8) {
    return ipv6Parts.every(part => /^[0-9a-fA-F]{1,4}$/.test(part));
  }
  return false;
}
// Role hierarchy for authorization checks
// P0-FIX: Added owner:4 — was missing, causing owners to be denied access
const roleHierarchy: Record<string, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};
const authAuditCallbacks: Array<(event: AuthAuditEvent) => void> = [];


export interface AuthAuditEvent {
  timestamp: Date;
  type: 'auth.success' | 'auth.failure' | 'auth.missing_token' | 'auth.invalid_token';
  ip: string;
  userAgent?: string | undefined;
  userId?: string | undefined;
  orgId?: string | undefined;
  reason?: string | undefined;
}

export interface RateLimitRecord {
  count: number;
  resetTime: number;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

/**
 * Register callback for auth audit events
 * @param callback - Callback function for audit events
 */
export function onAuthAudit(callback: (event: AuthAuditEvent) => void): void {
  authAuditCallbacks.push(callback);
}

/**
 * Emit auth audit event
 * @param event - Audit event to emit
 */
function emitAuthAudit(event: AuthAuditEvent): void {
  // Log for immediate visibility
  logger.info('Auth audit event', { type: event.type, ip: event.ip, reason: event.reason || 'success' });
  // Notify all registered callbacks
  for (const callback of authAuditCallbacks) {
    try {
      callback(event);
    }
    catch (err) {
      logger.error('Auth audit callback error', err instanceof Error ? err : new Error(String(err)));
    }
  }
}

interface ClientInfo {
  ip: string;
  userAgent?: string | undefined;
}

function getClientInfo(req: NextApiRequest): ClientInfo {
  const forwarded = req.headers['x-forwarded-for'];
  let ip: string;
  if (typeof forwarded === 'string') {
    // SECURITY FIX: Validate and take first trusted IP (closest to client)
    const ips = forwarded.split(',').map(ip => ip.trim()).filter(Boolean);
    // Take the first IP (closest to client) if no trusted proxy chain
    const clientIp = ips[0] || req.socket?.remoteAddress || 'unknown';
    // Validate IP format
    if (!isValidIP(clientIp!)) {
      ip = (req.socket?.remoteAddress || 'unknown') as string;
    }
    else {
      ip = clientIp as string;
    }
  }
  else if (Array.isArray(forwarded) && forwarded.length > 0) {
    const clientIp = forwarded[0];
    ip = (isValidIP(clientIp!) ? clientIp : req.socket?.remoteAddress || 'unknown') as string;
  }
  else {
    ip = (req.socket?.remoteAddress || 'unknown') as string;
  }
  // Normalize IP
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  return {
    ip,
    userAgent: req.headers['user-agent'],
  };
}
/**
 * Bearer token format regex for validation
 * SECURITY FIX: Validate Authorization header format
 */
// SECURITY FIX: Accept all base64url characters, use greedy quantifiers
const BEARER_REGEX = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
/**
 * Map JWT role to AuthContext role
 * SECURITY FIX: Don't silently default to viewer role - throw error for invalid roles
 */
function mapRole(jwtRole: unknown): UserRole {
  const validRoles: UserRole[] = ['owner', 'admin', 'editor', 'viewer'];
  if (typeof jwtRole === 'string' && validRoles.includes(jwtRole as UserRole)) {
    return jwtRole as UserRole;
  }
  // SECURITY FIX: Throw error instead of silently defaulting to viewer
  throw new Error(`Invalid role claim: ${jwtRole}`);
}
/**
 * Validate secure context in production
 * SECURITY FIX: Add HTTPS check in production
 */
function validateSecureContext(req: NextApiRequest): void {
  if (process.env['NODE_ENV'] === 'production') {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const isHttps = forwardedProto?.includes('https') || (req.socket as { encrypted?: boolean }).encrypted;
    if (!isHttps) {
      throw new AuthError('Secure connection (HTTPS) required in production');
    }
  }
}
/**

 * Uses crypto.timingSafeEqual for secure comparison
 *
 * SECURITY: This implementation ALWAYS takes constant time regardless of:
 * - Whether strings match or not
 * - Whether lengths match or not
 * - Position of first differing character
 *
 * The pattern: pad both buffers to the same (max) length, compare using
 * timingSafeEqual, AND the result with length equality check.
 */
function constantTimeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  const maxLen = Math.max(aBuf.length, bBuf.length);
  // SECURITY: Always pad to max length to avoid early returns
  // This ensures the timing is identical regardless of input lengths
  const aPadded = Buffer.alloc(maxLen, 0);
  const bPadded = Buffer.alloc(maxLen, 0);
  aBuf.copy(aPadded);
  bBuf.copy(bPadded);
  try {
    // TimingSafeEqual takes constant time based on buffer length
    // The && a.length === b.length ensures we also check length equality
    // But the timing is still constant because we always run both operations
    return crypto.timingSafeEqual(aPadded, bPadded) && a.length === b.length;
  }
  catch {
    return false;
  }
}
/**

 * Validates Authorization header format without leaking timing information
 */
function validateAuthHeaderConstantTime(authHeader: string): boolean {
  if (!authHeader) {
    return false;
  }
  // Check prefix using constant-time comparison
  const prefix = 'Bearer ';
  if (authHeader.length <= prefix.length) {
    return false;
  }
  const actualPrefix = authHeader.slice(0, prefix.length);
  return constantTimeCompare(actualPrefix, prefix);
}

interface AuthResult {
  userId: string;
  orgId: string;
  roles: UserRole[];
  sessionId?: string | undefined;
  requestId: string;
}

/**
 * Extract and validate authentication from request
 * Supports Bearer tokens with JWT verification

 */
export async function requireAuth(req: NextApiRequest, res: NextApiResponse): Promise<AuthResult> {
  const clientInfo = getClientInfo(req);
  // SECURITY FIX: Validate secure context in production
  try {
    validateSecureContext(req);
  }
  catch (error) {
    emitAuthAudit({
      timestamp: new Date(),
      type: 'auth.failure',
      ip: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      reason: 'Insecure connection in production',
    });
    res.status(403).json({ error: 'Secure connection required' });
    throw error;
  }
  // Extract Bearer token from Authorization header
  const authHeader = req.headers.authorization;

  // SECURITY FIX: Always call validation to prevent timing leak
  const hasHeader = authHeader !== undefined;
  const isValidFormat = hasHeader && validateAuthHeaderConstantTime(authHeader);
  if (!hasHeader || !isValidFormat) {
    emitAuthAudit({
      timestamp: new Date(),
      type: 'auth.missing_token',
      ip: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      reason: 'Missing or invalid Authorization header',
    });
    res.status(401).json({ error: 'Unauthorized. Bearer token required.' });
    throw new AuthError('Missing or invalid Authorization header');
  }
  // SECURITY FIX: Validate Authorization header format using regex after prefix check
  if (!BEARER_REGEX.test(authHeader)) {
    emitAuthAudit({
      timestamp: new Date(),
      type: 'auth.invalid_token',
      ip: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      reason: 'Invalid token format',
    });
    res.status(401).json({ error: 'Unauthorized. Invalid token format.' });
    throw new AuthError('Invalid token format');
  }
  const token = authHeader.slice(7);
  if (!token || token.length < 10) {
    emitAuthAudit({
      timestamp: new Date(),
      type: 'auth.invalid_token',
      ip: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      reason: 'Invalid token format',
    });
    res.status(401).json({ error: 'Unauthorized. Invalid token format.' });
    throw new AuthError('Invalid token format');
  }
  try {

    // SECURITY FIX: Use JWT_KEY_1/JWT_KEY_2 to match the signing service
    // (control-plane/services/jwt.ts). JWT_SECRET was a different env var that
    // caused tokens signed by the control plane to fail verification here.
    const jwtKey1 = process.env['JWT_KEY_1'];
    const jwtKey2 = process.env['JWT_KEY_2'];
    if (!jwtKey1) {
      logger.error('JWT_KEY_1 not configured');
      emitAuthAudit({
        timestamp: new Date(),
        type: 'auth.failure',
        ip: clientInfo.ip,
        userAgent: clientInfo.userAgent,
        reason: 'JWT signing key not configured',
      });
      res.status(500).json({ error: 'Authentication service misconfigured' });
      throw new AuthError('JWT signing key not configured');
    }
    if (jwtKey1.length < 32) {
      logger.error('JWT_KEY_1 too short (must be >= 32 characters)');
      res.status(500).json({ error: 'Authentication service misconfigured' });
      throw new AuthError('JWT signing key too short');
    }
    // Verify JWT token locally with key rotation support
    const jwtVerifyOptions: jwt.VerifyOptions = {
      audience: process.env['JWT_AUDIENCE'] || 'smartbeak',
      issuer: process.env['JWT_ISSUER'] || 'smartbeak-api',
      algorithms: ['HS256'],
      clockTolerance: 30, // SECURITY FIX: Allow 30 seconds clock skew
      complete: false,
    };
    let claims: jwt.JwtPayload;
    try {
      claims = jwt.verify(token, jwtKey1, jwtVerifyOptions) as jwt.JwtPayload;
    }
    catch (primaryErr) {
      // Try second key for rotation support
      if (jwtKey2 && jwtKey2.length >= 32) {
        try {
          claims = jwt.verify(token, jwtKey2, jwtVerifyOptions) as jwt.JwtPayload;
        } catch (secondaryErr) {
          // P25-FIX: Do not embed JWT library error messages in audit events —
          // they may contain token fragments or key hints.
          logger.debug('Token verification detail', {
            errorCode: secondaryErr instanceof Error ? secondaryErr.name : 'unknown',
          });
          emitAuthAudit({
            timestamp: new Date(),
            type: 'auth.failure',
            ip: clientInfo.ip,
            userAgent: clientInfo.userAgent,
            reason: 'Token verification failed',
          });
          res.status(401).json({ error: 'Unauthorized. Invalid or expired token.' });
          throw new AuthError('Token verification failed');
        }
      } else {
        // P26-FIX: Do not embed JWT library error messages in audit events.
        logger.debug('Token verification detail', {
          errorCode: primaryErr instanceof Error ? primaryErr.name : 'unknown',
        });
        emitAuthAudit({
          timestamp: new Date(),
          type: 'auth.failure',
          ip: clientInfo.ip,
          userAgent: clientInfo.userAgent,
          reason: 'Token verification failed',
        });
        res.status(401).json({ error: 'Unauthorized. Invalid or expired token.' });
        throw new AuthError('Token verification failed');
      }
    }

    // P0-8 FIX: Tokens without an exp claim must be rejected — jsonwebtoken only
    // enforces expiry when exp is present. A token with no exp is valid forever.
    if (!claims.exp) {
      emitAuthAudit({
        timestamp: new Date(),
        type: 'auth.failure',
        ip: clientInfo.ip,
        userAgent: clientInfo.userAgent,
        reason: 'Token missing exp claim',
      });
      res.status(401).json({ error: 'Unauthorized. Token missing expiration.' });
      throw new AuthError('Token missing exp claim');
    }

    if (!claims.sub) {
      emitAuthAudit({
        timestamp: new Date(),
        type: 'auth.failure',
        ip: clientInfo.ip,
        userAgent: clientInfo.userAgent,
        userId: claims.sub,
        reason: 'Token missing sub claim',
      });
      res.status(401).json({ error: 'Unauthorized. Token missing user ID.' });
      throw new AuthError('Token missing sub claim');
    }
    if (!claims["orgId"]) {
      emitAuthAudit({
        timestamp: new Date(),
        type: 'auth.failure',
        ip: clientInfo.ip,
        userAgent: clientInfo.userAgent,
        userId: claims.sub,
        reason: 'Token missing orgId claim',
      });
      res.status(401).json({ error: 'Unauthorized. Organization context required.' });
      throw new AuthError('Token missing orgId claim');
    }

    // This prevents timing attacks by validating token binding early
    if (claims["boundOrgId"]) {
      // Use constant-time comparison to prevent timing attacks on org ID validation
      if (!constantTimeCompare(claims["boundOrgId"] as string, claims["orgId"] as string)) {
        emitAuthAudit({
          timestamp: new Date(),
          type: 'auth.failure',
          ip: clientInfo.ip,
          userAgent: clientInfo.userAgent,
          userId: claims.sub,
          orgId: claims["orgId"] as string,
          reason: 'Token org binding mismatch - possible token theft',
        });
        res.status(401).json({ error: 'Unauthorized. Token binding validation failed.' });
        throw new AuthError('Token binding validation failed');
      }
    }
    // Success audit log
    emitAuthAudit({
      timestamp: new Date(),
      type: 'auth.success',
      ip: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      userId: claims.sub,
      orgId: claims["orgId"] as string,
    });
    // P30-FIX: Use 16 bytes (128-bit) randomness for collision-resistant request IDs.
    // 4 bytes was insufficient under high concurrency with same-millisecond timestamps.
    const requestId = `req_${randomBytes(16).toString('hex')}`;
    return {
      userId: claims.sub,
      orgId: claims["orgId"] as string,
      roles: [mapRole(claims["role"])],
      sessionId: claims.jti,
      requestId,
    };
  }
  catch (error) {
    if (res.writableEnded) {
      // Response already sent
      throw error;
    }
    // Unexpected error
    logger.error('Unexpected error in requireAuth', error instanceof Error ? error : new Error(String(error)));
    emitAuthAudit({
      timestamp: new Date(),
      type: 'auth.failure',
      ip: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      reason: 'Unexpected authentication system error',
    });
    res.status(500).json({ error: 'Internal server error during authentication' });
    throw new AuthError('Authentication system error');
  }
}
/**
 * Optional auth - returns null if not authenticated
 * SECURITY FIX: Explicitly check token expiration
 */
export async function optionalAuth(req: NextApiRequest): Promise<AuthResult | null> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !validateAuthHeaderConstantTime(authHeader)) {
    return null;
  }
  // SECURITY FIX: Validate Authorization header format using regex after prefix check
  if (!BEARER_REGEX.test(authHeader)) {
    return null;
  }
  const token = authHeader.slice(7);
  if (!token || token.length < 10) {
    return null;
  }
  try {

    // SECURITY FIX: Use JWT_KEY_1/JWT_KEY_2 to match the signing service
    const jwtKey1 = process.env['JWT_KEY_1'];
    const jwtKey2 = process.env['JWT_KEY_2'];
    if (!jwtKey1 || jwtKey1.length < 32) {
      logger.error('JWT_KEY_1 not configured or too short');
      return null;
    }

    const optionalVerifyOptions: jwt.VerifyOptions = {
      audience: process.env['JWT_AUDIENCE'] || 'smartbeak',
      issuer: process.env['JWT_ISSUER'] || 'smartbeak-api',
      algorithms: ['HS256'],
      clockTolerance: 30, // SECURITY FIX: Allow 30 seconds clock skew
      complete: false,
    };

    let claims: jwt.JwtPayload;
    try {
      claims = jwt.verify(token, jwtKey1, optionalVerifyOptions) as jwt.JwtPayload;
    } catch {
      // Try second key for rotation support
      if (jwtKey2 && jwtKey2.length >= 32) {
        claims = jwt.verify(token, jwtKey2, optionalVerifyOptions) as jwt.JwtPayload;
      } else {
        throw new Error('Token verification failed');
      }
    }
    // SECURITY FIX: Explicitly check exp claim
    if (!claims.exp || claims.exp * 1000 < Date.now()) {
      return null;
    }
    if (!claims.sub || !claims["orgId"]) {
      return null;
    }

    if (claims["boundOrgId"]) {
      if (!constantTimeCompare(claims["boundOrgId"] as string, claims["orgId"] as string)) {
        return null;
      }
    }
    // P30-FIX: Use 16 bytes (128-bit) randomness for collision-resistant request IDs.
    // 4 bytes was insufficient under high concurrency with same-millisecond timestamps.
    const requestId = `req_${randomBytes(16).toString('hex')}`;
    return {
      userId: claims.sub,
      orgId: claims["orgId"] as string,
      roles: [mapRole(claims["role"])],
      sessionId: claims.jti,
      requestId,
    };
  }
  catch (err) {

    if (err instanceof Error && err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError') {
      logger.error('Unexpected error in optionalAuth', err instanceof Error ? err : new Error(String(err)));
    }
    // Invalid token, return null
    return null;
  }
}
/**
 * Check if user can access domain
 * Queries database for domain ownership/membership
 * SECURITY FIX: Added role-based authorization check
 */
export async function canAccessDomain(userId: string, domainId: string, db: Pool, requiredRole = 'viewer'): Promise<boolean> {
  // If no database provided, deny access (secure default)
  if (!db) {
    logger.warn('canAccessDomain called without database connection');
    return false;
  }
  try {
    // SECURITY FIX: Check role level in addition to membership
    const { rows } = await db.query(`SELECT m.role FROM domain_registry dr
    JOIN memberships m ON m.org_id = dr.org_id
    WHERE dr.domain_id = $1 AND m.user_id = $2
    LIMIT 1`, [domainId, userId]);
    if (rows.length === 0) {
      return false;
    }
    // SECURITY FIX: Check if user's role meets required role level
    const userRole = rows[0]["role"] as string;
    return roleHierarchy[userRole]! >= roleHierarchy[requiredRole]!;
  }
  catch (error) {
    logger.error('Error checking domain access', error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}
/**
 * Verify domain access in getServerSideProps.
 * Combines Clerk auth + domain ownership check.
 * Returns userId if authorized, or a redirect/notFound result for early return.
 */
export async function requireDomainAccess(
  req: GetServerSidePropsContext['req'],
  domainId: string
): Promise<
  | { authorized: true; userId: string }
  | { authorized: false; result: { notFound: true } | { redirect: { destination: string; permanent: false } } }
> {
  const { userId } = getAuth(req);
  if (!userId) {
    return {
      authorized: false,
      result: { redirect: { destination: '/login', permanent: false } },
    };
  }
  const pool = await getPoolInstance();
  const hasAccess = await canAccessDomain(userId, domainId, pool);
  if (!hasAccess) {
    return { authorized: false, result: { notFound: true } };
  }
  return { authorized: true, userId };
}
/**
 * Check if user is org admin
 */
export async function requireOrgAdmin(auth: AuthResult, res: NextApiResponse): Promise<void> {
  // P1 FIX: Check role hierarchy — owner (4) >= admin (3), so owners should pass
  const hasAdminAccess = auth.roles.some(role => (roleHierarchy[role] ?? 0) >= roleHierarchy['admin']!);
  if (!hasAdminAccess) {
    res.status(403).json({
      error: 'Forbidden. Admin access required.',
      required: 'admin',
      current: auth.roles
    });
    throw new AuthError('Admin access required');
  }
}
/**
 * Check if user has required role
 */
export function requireRole(auth: AuthResult, allowedRoles: UserRole[]): void {
  const hasRole = auth.roles.some(role => allowedRoles.includes(role));
  if (!hasRole) {
    throw new AuthError(`Required role: ${allowedRoles.join(' or ')}, current: ${auth.roles.join(', ')}`);
  }
}
/**
 * Validate request method
 */
export function validateMethod(req: NextApiRequest, res: NextApiResponse, allowedMethods: string[]): boolean {
  if (!allowedMethods.includes(req.method || '')) {
    res.status(405).json({
      error: 'Method not allowed',
      allowed: allowedMethods,
      current: req.method,
    });
    return false;
  }
  return true;
}
/**
 * Standard error response helper
 */
export function sendError(res: NextApiResponse, status: number, message: string, details?: unknown): void {
  res.status(status).json({
    error: message,
    ...(details && process.env['NODE_ENV'] === 'development' ? { details } : {}),
  });
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// In-memory fallback for Redis (single instance only)
const memoryRateLimitStore = new Map<string, RateLimitRecord>();
const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60 * 1000, // 1 minute
};
// SECURITY FIX: Cleanup old entries periodically (every 5 minutes) with TTL
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, record] of memoryRateLimitStore.entries()) {
    if (now > record.resetTime) {
      memoryRateLimitStore.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.info('Cleaned up expired rate limit entries', { count: cleaned });
  }
}, 5 * 60 * 1000).unref();
// SECURITY FIX: Maximum store size to prevent memory leak
const MAX_RATE_LIMIT_STORE_SIZE = 100000;
/**
 * Clean oldest entries if store is too large
 * SECURITY FIX: Prevent memory leak from unbounded store growth
 */
function cleanupOldestEntriesIfNeeded(): void {
  if (memoryRateLimitStore.size > MAX_RATE_LIMIT_STORE_SIZE) {
    const now = Date.now();
    // Remove expired entries first
    for (const [key, record] of memoryRateLimitStore.entries()) {
      if (now > record.resetTime) {
        memoryRateLimitStore.delete(key);
      }
    }
    // If still too large, remove oldest 10%
    if (memoryRateLimitStore.size > MAX_RATE_LIMIT_STORE_SIZE) {
      const entries = [...memoryRateLimitStore.entries()];
      entries.sort((a, b) => a[1].resetTime - b[1].resetTime);
      const toRemove = Math.floor(entries.length * 0.1);
      for (let i = 0; i < toRemove; i++) {
        memoryRateLimitStore.delete(entries[i]![0]);
      }
      logger.warn('Rate limit store exceeded max size, removed oldest entries', { removed: toRemove });
    }
  }
}
// Register shutdown handler to cleanup interval
setupShutdownHandlers();
registerShutdownHandler(() => {
  clearInterval(cleanupInterval);
});

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

/**
 * Apply rate limiting to a request
 * Returns true if request should be allowed, false if rate limited
 * SECURITY FIX: Added TTL and memory leak protection
 */
export function applyRateLimit(identifier: string, config: RateLimitConfig = DEFAULT_RATE_LIMIT): RateLimitResult {
  // SECURITY FIX: Clean up old entries if store is too large
  cleanupOldestEntriesIfNeeded();
  const now = Date.now();
  const key = identifier;
  const record = memoryRateLimitStore.get(key);
  if (!record || now > record.resetTime) {
    // New window
    const newRecord: RateLimitRecord = {
      count: 1,
      resetTime: now + config.windowMs,
    };
    memoryRateLimitStore.set(key, newRecord);
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetTime: newRecord.resetTime,
    };
  }
  // Existing window
  if (record.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: record.resetTime,
    };
  }
  record.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - record.count,
    resetTime: record.resetTime,
  };
}
/**
 * Rate limiting middleware for API routes
 * Returns true if request should proceed, false if rate limited (and sends 429 response)
 */
export function checkRateLimit(req: NextApiRequest, res: NextApiResponse, identifier: string, config?: RateLimitConfig): boolean {
  const result = applyRateLimit(identifier, config);
  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', config?.maxRequests || DEFAULT_RATE_LIMIT.maxRequests);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));
  res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));
  if (!result.allowed) {
    res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
    });
    return false;
  }
  return true;
}
/**
 * Get rate limit identifier from request (IP + optional user)
 */
export function getRateLimitIdentifier(req: NextApiRequest, userId?: string): string {
  // Use x-forwarded-for if behind proxy, fallback to socket.remoteAddress
  const forwarded = req.headers['x-forwarded-for'];
  let ip: string;
  if (typeof forwarded === 'string') {

    // P1-FIX: Use first IP (client IP), not last (proxy IP), for consistency with getClientInfo
    const ips = forwarded.split(',').map(s => s.trim()).filter(Boolean);
    ip = (ips.length > 0 ? ips[0] : req.socket?.remoteAddress || 'unknown') as string;
  }
  else if (Array.isArray(forwarded) && forwarded.length > 0) {
    ip = forwarded[0] as string;
  }
  else {
    ip = (req.socket?.remoteAddress || 'unknown') as string;
  }
  // Normalize IP (remove IPv6 prefix if IPv4-mapped)
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  // P33-FIX: Do not truncate IPv6 addresses. The previous logic split on ':' and
  // took the first segment, collapsing all 2001::/16 users into one rate-limit
  // bucket and enabling cross-user DoS. Wrap IPv6 in brackets to keep it intact.
  const isIpv6 = ip.includes(':') && !ip.startsWith('::ffff:');
  const ipKey = isIpv6 ? `[${ip}]` : ip;
  return userId ? `${ipKey}:${userId}` : ipKey;
}

export interface WithAuthOptions {
  methods?: string[];
  rateLimit?: RateLimitConfig;
  requireOrgAdmin?: boolean;
}

export type ApiHandler = (req: NextApiRequest, res: NextApiResponse, auth: AuthResult) => Promise<void> | void;

/**
 * Higher-order function for protected API handlers
 */
export function withAuth(handler: ApiHandler, options?: WithAuthOptions): (req: NextApiRequest, res: NextApiResponse) => Promise<void> {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      // Validate method
      if (options?.methods && !options.methods.includes(req.method || '')) {
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }
      // Apply rate limiting if configured
      if (options?.rateLimit) {
        const identifier = getRateLimitIdentifier(req);
        if (!checkRateLimit(req, res, identifier, options.rateLimit)) {
          return;
        }
      }
      // Authenticate
      const auth = await requireAuth(req, res);
      // Check org admin if required
      if (options?.requireOrgAdmin) {
        await requireOrgAdmin(auth, res);
      }
      // Call handler
      await handler(req, res, auth);
    }
    catch (error) {
      if (error instanceof AuthError) {
        // Already handled in requireAuth/requireOrgAdmin
        return;
      }
      logger.error('Unexpected error in withAuth', error instanceof Error ? error : new Error(String(error)));
      // Only send response if not already sent
      if (!res.writableEnded) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };
}
