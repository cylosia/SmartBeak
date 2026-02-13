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

