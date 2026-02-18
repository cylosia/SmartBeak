
import { verifyToken, JwtClaims } from './jwt';
import {
  TokenExpiredError as KernelTokenExpiredError,
  TokenRevokedError as KernelTokenRevokedError,
} from '@kernel/auth';

export type Role = 'admin' | 'editor' | 'viewer' | 'owner' | 'buyer';

// P1-AUDIT-FIX: Removed dual role/roles fields. Previously had both `role?: Role` and
// `roles?: string[]`, but authFromHeader only set `roles`. Functions like requireRole
// checked both, creating confusion and potential privilege escalation if they disagreed.
// Unified on `roles: Role[]` with proper Role type (not string[]).
export interface AuthContext {
  userId: string;
  orgId: string;
  domainId?: string | undefined;
  roles: Role[];
}

/**
* Base Auth Error class
*/
export class AuthError extends Error {
  constructor(
  message: string,
  public readonly code: string,
  public readonly statusCode: number = 401
  ) {
  super(message);
  this.name = 'AuthError';
  Object.setPrototypeOf(this, AuthError.prototype);
  }
}

/**
* Missing or invalid authorization header
*/
export class AuthorizationHeaderError extends AuthError {
  constructor(message: string = 'Missing or invalid Authorization header') {
  super(message, 'AUTHORIZATION_HEADER_MISSING', 401);
  this.name = 'AuthorizationHeaderError';
  Object.setPrototypeOf(this, AuthorizationHeaderError.prototype);
  }
}

/**
* Invalid token format or signature
*/
export class InvalidTokenError extends AuthError {
  constructor(message: string = 'Invalid token') {
  super(message, 'INVALID_TOKEN', 401);
  this.name = 'InvalidTokenError';
  Object.setPrototypeOf(this, InvalidTokenError.prototype);
  }
}

/**
* Token has expired
*/
export class TokenExpiredError extends AuthError {
  constructor(message: string = 'Token has expired') {
  super(message, 'TOKEN_EXPIRED', 401);
  this.name = 'TokenExpiredError';
  Object.setPrototypeOf(this, TokenExpiredError.prototype);
  }
}

/**
* Token has been revoked
*/
export class TokenRevokedError extends AuthError {
  constructor(message: string = 'Token has been revoked') {
  super(message, 'TOKEN_REVOKED', 401);
  this.name = 'TokenRevokedError';
  Object.setPrototypeOf(this, TokenRevokedError.prototype);
  }
}

/**
* Missing required claims in token
*/
export class MissingClaimsError extends AuthError {
  constructor(claim: string) {
  super(`Token missing required claim: ${claim}`, 'MISSING_CLAIMS', 401);
  this.name = 'MissingClaimsError';
  Object.setPrototypeOf(this, MissingClaimsError.prototype);
  }
}

/**
* Insufficient permissions for the requested resource
*/
export class ForbiddenError extends AuthError {
  constructor(message: string = 'Forbidden') {
  super(message, 'FORBIDDEN', 403);
  this.name = 'ForbiddenError';
  Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

/**
* Organization access denied
*/
export class OrganizationAccessError extends AuthError {
  constructor(message: string = 'Organization access denied') {
  super(message, 'ORG_ACCESS_DENIED', 403);
  this.name = 'OrganizationAccessError';
  Object.setPrototypeOf(this, OrganizationAccessError.prototype);
  }
}

/**
* Role-based access denied
*/
export class RoleAccessError extends AuthError {
  constructor(requiredRoles: Role[], currentRoles: Role[] | Role) {
  const currentRolesStr = Array.isArray(currentRoles) 
    ? currentRoles.join(', ') 
    : currentRoles;
  super(
    `Forbidden: Required role: ${requiredRoles.join(' or ')}, current: ${currentRolesStr}`,
    'ROLE_ACCESS_DENIED',
    403
  );
  this.name = 'RoleAccessError';
  Object.setPrototypeOf(this, RoleAccessError.prototype);
  }
}

/**
* Extract auth context from Authorization header
*
* Previously was synchronous but verifyToken returns a Promise
*/
export async function authFromHeader(header?: string): Promise<AuthContext> {
  if (!header) {
  throw new AuthorizationHeaderError('Missing Authorization header');
  }

  // Validate Bearer format
  if (!header.startsWith('Bearer ')) {
  throw new AuthorizationHeaderError('Invalid Authorization header format. Expected: Bearer <token>');
  }

  const token = header.slice(7);
  if (!token || token.length < 10) {
  throw new InvalidTokenError('Token too short or empty');
  }

  let claims: JwtClaims;
  try {
  claims = await verifyToken(token);
  } catch (error: unknown) {
  // P1-FIX: Use instanceof checks instead of fragile string matching on error messages
  if (error instanceof KernelTokenExpiredError) {
    throw new TokenExpiredError(error.message);
  }
  if (error instanceof KernelTokenRevokedError) {
    throw new TokenRevokedError(error.message);
  }
  const errorMessage = error instanceof Error ? error.message : String(error);
  throw new InvalidTokenError(`Token verification failed: ${errorMessage}`);
  }

  if (!claims.sub) {
  throw new MissingClaimsError('sub (user ID)');
  }

  if (!claims.orgId) {
  throw new MissingClaimsError('orgId');
  }

  if (!claims.role) {
  throw new MissingClaimsError('role');
  }

  // P0-FIX: Runtime validation of role value instead of unchecked `as Role` cast.
  // A malformed JWT could contain an arbitrary string in the role claim.
  // P0-BUG-FIX: Added 'buyer' — it is in the Role type union but was absent from
  // VALID_ROLES, causing every legitimate buyer JWT to throw InvalidTokenError with
  // "Invalid role in token: buyer". This silently blocks the entire buyer user class.
  const VALID_ROLES: readonly Role[] = ['admin', 'editor', 'viewer', 'owner', 'buyer'];
  if (!VALID_ROLES.includes(claims.role as Role)) {
  throw new InvalidTokenError(`Invalid role in token: ${claims.role}`);
  }

  return {
  userId: claims.sub,
  orgId: claims.orgId,
  roles: [claims.role as Role],
  };
}

/**
* Require specific role(s) for access
* @throws RoleAccessError if role is not in allowed list
*/
export function requireRole(ctx: AuthContext, allowed: Role[]): void {
  // P1-AUDIT-FIX: Single source of truth — only check ctx.roles (typed as Role[])
  if (ctx.roles.some(role => allowed.includes(role))) {
    return;
  }
  throw new RoleAccessError(allowed, ctx.roles);
}

/**
* Require access to specific organization
* @throws OrganizationAccessError if organization doesn't match
*/
export function requireOrgAccess(ctx: AuthContext, targetOrgId: string): void {
  if (ctx.orgId !== targetOrgId) {
  throw new OrganizationAccessError('Forbidden: Organization mismatch');
  }
}

/**
* Combined role and organization access check
* @throws AuthError if either check fails
*/
export function requireAccess(
  ctx: AuthContext,
  targetOrgId: string,
  allowedRoles: Role[]
): void {
  requireOrgAccess(ctx, targetOrgId);
  requireRole(ctx, allowedRoles);
}

/**
* Check if user has at least one of the allowed roles
* Returns boolean instead of throwing
*/
export function hasRole(ctx: AuthContext, allowed: Role[]): boolean {
  return ctx.roles.some(role => allowed.includes(role));
}

/**
* Check if user has access to organization
* Returns boolean instead of throwing
*/
export function hasOrgAccess(ctx: AuthContext, targetOrgId: string): boolean {
  return ctx.orgId === targetOrgId;
}
