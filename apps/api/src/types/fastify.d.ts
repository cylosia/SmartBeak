
/**
 * Centralized Fastify module augmentations
 */

/** P1-9: Exhaustive role union — typos like 'owmner' or 'Admin' are caught at compile time */
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

// Auth context interface
export interface AuthContext {
  userId: string;
  orgId: string;
  domainId?: string;
  roles: Role[];
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
