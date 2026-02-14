import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

import { FastifyInstance } from 'fastify';


/**
* Selectively migrated routes from apps/api/src/routes/
* Only includes routes that DON'T conflict with existing control-plane routes
*
* FIXED: Cross-boundary imports removed. Routes now use package imports.
*
* NOTE: These routes are now re-exported from control-plane locations.
* The actual route implementations should be moved from apps/api/src/routes/
* to control-plane/api/routes/ in a future refactoring.
*
* For now, we use a ROUTE_REGISTRY pattern that is populated at runtime
* by the apps/api during its initialization, avoiding direct imports.
*/

const logger = getLogger('apps-api-routes');

/**
* Route registry for apps/api routes
* Routes register themselves here to avoid cross-boundary imports
*/
export interface RouteModule {
  name: string;
  register: (app: FastifyInstance) => Promise<void>;
}

const routeRegistry: RouteModule[] = [];

/**
* Register a route module from apps/api
* This allows apps/api to register its routes without control-plane importing them
*/
export function registerRouteModule(name: string, register: (app: FastifyInstance) => Promise<void>): void {
  routeRegistry.push({ name, register });
  logger.debug(`Route module registered: ${name}`);
}

/**
* Check if any routes have been registered
*/
export function hasRegisteredRoutes(): boolean {
  return routeRegistry.length > 0;
}

/**
* Get the count of registered routes
*/
export function getRegisteredRouteCount(): number {
  return routeRegistry.length;
}

/**
* Clear all registered routes (useful for testing)
*/
export function clearRegisteredRoutes(): void {
  routeRegistry.length = 0;
}

/**
* Register all apps/api routes that have been registered via the registry
*
* NOTE: This approach avoids cross-boundary imports between control-plane and apps/api.
* The apps/api application should call registerRouteModule() for each of its routes
* during its initialization, before control-plane starts.
*/
export async function registerAppsApiRoutes(app: FastifyInstance, _pool: Pool): Promise<void> {
  if (routeRegistry.length === 0) {
  logger.warn('No apps/api routes registered. If apps/api is enabled, routes should be registered at startup.');
  return;
  }

  for (const routeModule of routeRegistry) {
  try {
    await routeModule.register(app);
    logger.debug(`Registered route module: ${routeModule.name}`);
  } catch (error) {
    logger.error(`Failed to register route module: ${routeModule.name}`, error as Error);
    throw error;
  }
  }

  logger.info(`[Routes] Registered ${routeRegistry.length} route modules from apps/api`);
}

// Re-export for convenience
export type { RouteModule as AppsApiRouteModule };
