import { getLogger } from '@kernel/logger';

/**
* Health Check Module
*
* Provides health check utilities for monitoring external services
* and database connection pools.
*/

const logger = getLogger('health-check');

// ============================================================================
// Type Definitions
// ============================================================================

/**
* Result of a health check
*/
export interface HealthCheckResult {
  /** Name of the health check */
  name: string;
  /** Whether the check passed */
  healthy: boolean;
  /** Response latency in milliseconds */
  latency: number;
  /** Error message if unhealthy */
  error?: string | undefined;
  /** Additional metadata */
  metadata?: Record<string, unknown> | undefined;
}

/**
* Health check interface
*/
export interface HealthCheck {
  /** Name of the health check */
  name: string;
  /** Execute the health check */
  check(): Promise<HealthCheckResult>;
  /** Check interval in milliseconds (optional) */
  intervalMs?: number;
}

// ============================================================================
// Internal State
// ============================================================================

interface StateStore {
  healthChecks: Map<string, HealthCheck>;
  lastResults: Map<string, HealthCheckResult>;
  timers: Map<string, NodeJS.Timeout>;
}

const stateStore: StateStore = {
  healthChecks: new Map<string, HealthCheck>(),
  lastResults: new Map<string, HealthCheckResult>(),
  timers: new Map<string, NodeJS.Timeout>()
};

// P2-DEAD-CODE-FIX: Removed _getHealthChecks and _getLastResults — never referenced.
// Internal mutable access
const getMutableHealthChecks = (): Map<string, HealthCheck> => stateStore.healthChecks;
const getMutableLastResults = (): Map<string, HealthCheckResult> => stateStore.lastResults;

// ============================================================================
// Health Check Functions
// ============================================================================

/**
* Get last health check result for a specific check
* @param name - Name of the health check
* @returns The last health check result or undefined if not found
*/
export function getLastHealthCheck(name: string): HealthCheckResult | undefined {
  return getMutableLastResults().get(name);
}

/**
* Register a health check
* @param check - Health check to register
*/
export function registerHealthCheck(check: HealthCheck): void {
  getMutableHealthChecks().set(check.name, check);

  // Set up periodic checks if interval specified
  if (check.intervalMs && check.intervalMs > 0) {
    // P1-FIX: Clear any existing timer before setting new one
    const existingTimer = stateStore.timers.get(check.name);
    if (existingTimer) {
    clearInterval(existingTimer);
    }

    const timer = setInterval(async () => {
    try {
        const result = await check.check();
        getMutableLastResults().set(check.name, result);
    } catch (err: unknown) {
        logger.error(`Health check '${check.name}' failed:`, err as Error);
        const errorMessage = err instanceof Error ? err.message : String(err);
        getMutableLastResults().set(check.name, {
        name: check.name,
        healthy: false,
        latency: 0,
        error: errorMessage,
        });
    }
    }, check.intervalMs).unref();

    // P1-FIX: Store timer for cleanup
    stateStore.timers.set(check.name, timer);
  }
}

/**
* P1-FIX: Cleanup health check timers
* @param name - Optional name of specific health check to cleanup, or all if not provided
*/
export function cleanupHealthCheckTimers(name?: string): void {
  if (name) {
    const timer = stateStore.timers.get(name);
    if (timer) {
    clearInterval(timer);
    stateStore.timers.delete(name);
    }
  } else {
    // Clear all timers
    for (const [checkName, timer] of stateStore.timers) {
    clearInterval(timer);
    stateStore.timers.delete(checkName);
    }
  }
}

/**
* Run all registered health checks
* @returns Overall health status and individual check results
*/
export async function checkAllHealth(): Promise<{
  healthy: boolean;
  checks: HealthCheckResult[];
  timestamp: string;
}> {
  // P1-FIX: Run all checks in parallel to avoid cascading timeout amplification.
  // P1-SECURITY-FIX: Wrap each check in a 10-second timeout to prevent indefinite hangs.
  // Unlike HealthChecksRegistry.runCheck() (monitoring module) which has per-check timeouts,
  // this kernel module previously had no timeout, so a single hanging check (e.g., DNS
  // resolution failure on external API) would block the entire health system forever.
  const DEFAULT_CHECK_TIMEOUT_MS = 10000;
  const healthChecks = Array.from(getMutableHealthChecks().entries());
  const results = await Promise.allSettled(
    healthChecks.map(async ([name, check]) => {
      let timeoutHandle: NodeJS.Timeout;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`Health check '${name}' timed out after ${DEFAULT_CHECK_TIMEOUT_MS}ms`)), DEFAULT_CHECK_TIMEOUT_MS);
      });
      try {
        const result = await Promise.race([check.check(), timeoutPromise]);
        clearTimeout(timeoutHandle!);
        getMutableLastResults().set(name, result);
        return result;
      } catch (err) {
        clearTimeout(timeoutHandle!);
        throw err;
      }
    })
  );

  const checks: HealthCheckResult[] = [];
  let allHealthy = true;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const entry = healthChecks[i];
    if (!result || !entry) continue;
    const [name] = entry;
    if (result.status === 'fulfilled') {
      checks.push(result.value);
      if (!result.value.healthy) allHealthy = false;
    } else {
      const errorMessage = result.reason instanceof Error ? result.reason.message : String(result.reason);
      const failedResult: HealthCheckResult = {
        name,
        healthy: false,
        latency: 0,
        error: errorMessage,
      };
      getMutableLastResults().set(name, failedResult);
      checks.push(failedResult);
      allHealthy = false;
    }
  }

  return {
  healthy: allHealthy,
  checks,
  timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Health Check Factories
// ============================================================================

interface PoolMetrics {
  total: number;
  idle: number;
  waiting: number;
}

/**
* Create database health check
* @param name - Name of the health check
* @param queryFn - Function to execute a test query
* @param poolMetricsFn - Optional function to get pool metrics
* @returns Database health check
*/
export function createDatabaseHealthCheck(
  name: string,
  queryFn: () => Promise<unknown>,
  poolMetricsFn?: () => PoolMetrics
): HealthCheck {
  return {
  name,
  intervalMs: 30000, // Check every 30 seconds
  async check(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
    await queryFn();
    const latency = Date.now() - start;

    const metadata: Record<string, unknown> = { latency };
    if (poolMetricsFn) {
    const metrics = poolMetricsFn();
    metadata['pool'] = metrics;

    // Warn if pool is saturated
    if (metrics.waiting > 5) {
    logger.warn('Database pool has waiting connections', { metrics });
    }
    }

    return {
    name,
    healthy: true,
    latency,
    metadata,
    };
    } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
    name,
    healthy: false,
    latency: Date.now() - start,
    error: errorMessage,
    };
    }
  },
  };
}

/**
* Create external API health check
* @param name - Name of the health check
* @param healthUrl - URL to check
* @param options - Optional configuration
* @returns External API health check
*/
export function createExternalApiHealthCheck(
  name: string,
  healthUrl: string,
  options?: {
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  expectedStatus?: number;
  }
): HealthCheck {
  const { method = 'GET', headers = {}, timeoutMs = 5000, expectedStatus = 200 } = options || {};

  return {
  name,
  intervalMs: 60000, // Check every minute
  async check(): Promise<HealthCheckResult> {
    const start = Date.now();
    let timeout: NodeJS.Timeout | undefined;

    try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(healthUrl, {
      method,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const latency = Date.now() - start;
    // P1-FIX: 401 Unauthorized should NOT be considered healthy
    // Only 2xx status codes indicate healthy services
    const healthy = response.status >= 200 && response.status < 300 && response.status === expectedStatus;

    return {
    name,
    healthy,
    latency,
    error: healthy ? undefined : `Unexpected status: ${response.status}`,
    metadata: { status: response.status },
    };
    } catch (err: unknown) {
    if (timeout) clearTimeout(timeout);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
    name,
    healthy: false,
    latency: Date.now() - start,
    error: errorMessage,
    };
    }
  },
  };
}

/**
* Create Redis health check
* @param name - Name of the health check
* @param redis - Redis client with ping method
* @returns Redis health check
*/
export function createRedisHealthCheck(
  name: string,
  redis: { ping(): Promise<string> }
): HealthCheck {
  return {
  name,
  intervalMs: 30000,
  async check(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
    const result = await redis.ping();
    const latency = Date.now() - start;

    return {
    name,
    healthy: result === 'PONG',
    latency,
    metadata: { pong: result },
    };
    } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
    name,
    healthy: false,
    latency: Date.now() - start,
    error: errorMessage,
    };
    }
  },
  };
}

// ============================================================================
// Middleware
// ============================================================================

// P1-FIX: Define proper types for middleware
export interface MiddlewareRequest {
  url: string;
}

export interface MiddlewareResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(data: string): void;
}

export interface MiddlewareNext {
  (): void;
}

/**
* Express/Fastify middleware for health endpoint
* P1-FIX: Use proper types instead of any
* @param path - URL path for health endpoint
* @returns Middleware function
*/
export function healthCheckMiddleware(
  path: string = '/health'
): (req: MiddlewareRequest, res: MiddlewareResponse, next?: MiddlewareNext) => Promise<void> {
  return async (req: MiddlewareRequest, res: MiddlewareResponse, next?: MiddlewareNext) => {
    // P1-FIX: Compare pathname only, ignoring query strings.
    // req.url includes query string (e.g., '/health?verbose=true'),
    // so exact match would fail for monitoring tools adding cache-busting params.
    const pathname = req.url.split('?')[0];
    if (pathname !== path) {
      next?.();
      return;
    }

    const health = await checkAllHealth();
    const statusCode = health.healthy ? 200 : 503;

    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    // P1-SECURITY-FIX: Only return { healthy, timestamp } on the public endpoint.
    // Previously returned full health check details including error messages and metadata
    // (pool counts, latencies, error strings from pg/ioredis that may contain connection URLs),
    // exposing infrastructure information useful for reconnaissance.
    res.end(JSON.stringify({ healthy: health.healthy, timestamp: health.timestamp }));
  };
}
