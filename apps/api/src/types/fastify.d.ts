

/**
* Centralized Fastify module augmentations

*/

// Auth context interface (Issue 8: Using 'roles' array consistently)
export interface AuthContext {
  userId: string;
  orgId: string;
  domainId?: string;
  roles: string[];
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
