
/**
 * Centralized Fastify module augmentations
 *
 * P1 FIX: Removed the duplicate `AuthContext` definition that had
 * `roles: Role[]` while `packages/security/jwt.ts getAuthContext()` returns
 * `roles: string[]`. The mismatch meant any middleware that assigned
 * `req.auth = getAuthContext(headers)` would fail TypeScript type checking
 * (string[] is not assignable to Role[]).
 *
 * Fix: Import the canonical `AuthContext` from `@security` and extend it with
 * the Fastify-layer `domainId` field. The `Role` type union is kept for use
 * in permission checks (e.g., `if (auth.roles.includes('admin' satisfies Role))`).
 */

import type { AuthContext as BaseAuthContext } from '@security';

// AUDIT-FIX H2: Added 'buyer' role to match UserRoleSchema across the codebase.
/** P1-9: Exhaustive role union — typos like 'owmner' or 'Admin' are caught at compile time */
export type Role = 'owner' | 'admin' | 'editor' | 'viewer' | 'buyer';

/**
 * Request-level auth context attached by route middleware.
 * Extends the canonical JWT auth context with Fastify-specific fields.
 *
 * roles: string[] is intentional — it matches the return type of getAuthContext()
 * from @security/jwt. Use the `Role` type above for compile-time validation in
 * permission checks: `auth.roles.includes('admin' satisfies Role)`.
 */
export interface AuthContext extends BaseAuthContext {
  domainId?: string | undefined;
}

declare module 'fastify' {
  export interface FastifyRequest {
    auth?: AuthContext;
    user?: {
      id?: string | undefined;
      orgId?: string | undefined;
      stripeCustomerId?: string | undefined;
    };
  }
}
