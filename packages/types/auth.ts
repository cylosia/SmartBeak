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
  /** Unique identifier for the authenticated user */
  userId: string;
  /** Organization the user belongs to */
  orgId: string;
  /** Array of roles assigned to the user (supports multiple simultaneous roles) */
  roles: string[];
  /** Optional session identifier for request tracking */
  sessionId?: string;
  /** Optional request identifier for distributed tracing */
  requestId?: string;
}

/**
 * Standard user roles across the application
 */
// P1-4 FIX: Added 'buyer' role to match packages/security/jwt.ts and
// control-plane/services/jwt.ts. Without this, buyer-role tokens fail
// validation on code paths using this type.
export type UserRole = 'admin' | 'editor' | 'viewer' | 'owner' | 'buyer';

/**
 * Role hierarchy for authorization checks (higher number = more permissions)
 */
export const roleHierarchy: Record<UserRole, number> = {
  buyer: 0,
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

/**
 * Check if a user has a specific role
 */
export function hasRole(roles: string[], role: string): boolean {
  return roles.includes(role);
}

/**
 * Check if a user has any of the specified roles
 */
export function hasAnyRole(roles: string[], requiredRoles: string[]): boolean {
  return requiredRoles.some(role => roles.includes(role));
}

/**
 * Check if a user has all of the specified roles
 */
export function hasAllRoles(roles: string[], requiredRoles: string[]): boolean {
  return requiredRoles.every(role => roles.includes(role));
}

/**
 * Get the highest privilege role from a list of roles
 */
export function getHighestRole(roles: string[]): UserRole | undefined {
  let highest: UserRole | undefined;
  let highestLevel = 0;
  for (const role of roles) {
    const level = roleHierarchy[role as UserRole];
    if (level !== undefined && level > highestLevel) {
      highest = role as UserRole;
      highestLevel = level;
    }
  }
  return highest;
}

/**
 * Require a specific role, throwing if not present
 */
export function requireRole(roles: string[], role: UserRole): void {
  if (!hasRole(roles, role)) {
    throw new Error(`Required role '${role}' not found`);
  }
}

/**
 * Check if user's role meets or exceeds the required role level
 */
export function hasRequiredRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return (roleHierarchy[userRole] ?? 0) >= (roleHierarchy[requiredRole] ?? 0);
}

