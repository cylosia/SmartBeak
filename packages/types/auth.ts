/**
 * Canonical AuthContext Type Definition
 * 
 * This is the single source of truth for authentication context
 * across the entire SmartBeak application.
 * 
 * P1-FIX: Standardized on roles: string[] array instead of single role
 * This allows users to have multiple roles simultaneously.
 */

export interface AuthContext {
  userId: string;
  orgId: string;
  roles: string[];
  sessionId?: string;
  requestId?: string;
}

/**
 * Standard user roles across the application
 */
export type UserRole = 'admin' | 'editor' | 'viewer' | 'owner';

/**
 * Role hierarchy for authorization checks (higher number = more permissions)
 */
export const roleHierarchy: Record<UserRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

/**
 * Check if user has a specific role
 * @param ctx - Auth context
 * @param role - Role to check
 * @returns True if user has the role
 */
export function hasRole(ctx: AuthContext, role: string): boolean {
  return ctx.roles.includes(role);
}

/**
 * Check if user has at least one of the required roles
 * @param ctx - Auth context
 * @param allowedRoles - Array of allowed roles
 * @returns True if user has at least one allowed role
 */
export function hasAnyRole(ctx: AuthContext, allowedRoles: string[]): boolean {
  return ctx.roles.some(role => allowedRoles.includes(role));
}

/**
 * Check if user has all required roles
 * @param ctx - Auth context
 * @param requiredRoles - Array of required roles
 * @returns True if user has all required roles
 */
export function hasAllRoles(ctx: AuthContext, requiredRoles: string[]): boolean {
  return requiredRoles.every(role => ctx.roles.includes(role));
}

/**
 * Get the highest role from user's roles based on hierarchy
 * @param ctx - Auth context
 * @returns The highest role or undefined
 */
export function getHighestRole(ctx: AuthContext): UserRole | undefined {
  const userRoles = ctx.roles.filter((r): r is UserRole => r in roleHierarchy);
  if (userRoles.length === 0) return undefined;
  
  return userRoles.reduce((highest, role) => 
    roleHierarchy[role] > roleHierarchy[highest] ? role : highest
  );
}

/**
 * Require specific role(s) for access - throws if not satisfied
 * @param ctx - Auth context
 * @param allowedRoles - Array of allowed roles
 * @throws Error if user doesn't have any of the allowed roles
 */
export function requireRole(ctx: AuthContext, allowedRoles: string[]): void {
  if (!hasAnyRole(ctx, allowedRoles)) {
    throw new Error(
      `Forbidden: Required role: ${allowedRoles.join(' or ')}, current: ${ctx.roles.join(', ')}`
    );
  }
}

/**
 * Check if user has required role level
 * @param ctx - Auth context
 * @param minRole - Minimum required role level
 * @returns True if user's highest role meets the requirement
 */
export function hasRequiredRole(ctx: AuthContext, minRole: UserRole): boolean {
  const highestRole = getHighestRole(ctx);
  if (!highestRole) return false;
  return roleHierarchy[highestRole] >= roleHierarchy[minRole];
}
