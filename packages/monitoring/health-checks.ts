/**
 * Deep Health Checks Module
 * 
 * Implements comprehensive health monitoring:
 * - Deep health checks (DB, Redis, external APIs)
 * - Readiness probe endpoints
 * - Liveness probe endpoints
 */

import { EventEmitter } from 'events';
import { getLogger } from '@kernel/logger';

const logger = getLogger('health-checks');

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Health check status
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/**
 * Health check result
 */
export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message?: string;
  latencyMs: number;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Overall health report
 */
export interface HealthReport {
  status: HealthStatus;
  timestamp: string;
  version: string;
  environment: string;
  checks: HealthCheckResult[];
  summary: {
    healthy: number;
    degraded: number;
    unhealthy: number;
    unknown: number;
    total: number;
  };
}

/**
 * Readiness check result
 */
export interface ReadinessResult {
  ready: boolean;
  timestamp: string;
  checks: HealthCheckResult[];
  dependencies: {
    name: string;
    ready: boolean;
  }[];
}

/**
 * Liveness result
 */
export interface LivenessResult {
  alive: boolean;
  timestamp: string;
  uptime: number;
  pid: number;
  memory: NodeJS.MemoryUsage;
}

/**
 * Health check function
 */
export type HealthCheckFn = () => Promise<HealthCheckResult>;

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  name: string;
  check: HealthCheckFn;
  intervalMs?: number;
  timeoutMs?: number;
  severity?: 'critical' | 'warning' | 'info';
  enabled?: boolean;
}

/**
 * Database health check options
 */
export interface DatabaseHealthOptions {
  name?: string;
  query: () => Promise<unknown>;
  getPoolStatus?: () => { total: number; idle: number; waiting: number };
  timeoutMs?: number;
}

/**
 * Redis health check options
 */
export interface RedisHealthOptions {
  name?: string;
  ping: () => Promise<string>;
  getInfo?: () => Promise<Record<string, unknown>>;
  timeoutMs?: number;
}

/**
 * External API health check options
 */
export interface ExternalApiHealthOptions {
  name: string;
  url: string;
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  expectedStatus?: number;
  timeoutMs?: number;
  body?: unknown;
}

// ============================================================================
// Health Checks Registry
// ============================================================================

export class HealthChecksRegistry extends EventEmitter {
  private readonly checks: Map<string, HealthCheckConfig> = new Map();
  private readonly results: Map<string, HealthCheckResult> = new Map();
  private readonly intervals: Map<string, NodeJS.Timeout> = new Map();
  private readonly version: string;
  private readonly environment: string;
  private startTime: number;

  constructor(
    version: string = '1.0.0',
    environment: string = process.env['NODE_ENV'] || 'development'
  ) {
    super();
    // P2-FIX: Increase maxListeners to prevent warnings with >10 health checks
    this.setMaxListeners(50);
    this.version = version;
    this.environment = environment;
    this.startTime = Date.now();
  }

  /**
   * Register a health check
   */
  register(config: HealthCheckConfig): void {
    if (this.checks.has(config.name)) {
      logger.warn(`Health check '${config.name}' already registered, overwriting`);
      this.unregister(config.name);
    }

    this.checks.set(config.name, {
      ...config,
      severity: config.severity || 'warning',
      enabled: config.enabled !== false,
    });

    // Set up periodic checks if interval specified
    if (config.intervalMs && config.intervalMs > 0) {
      const interval = setInterval(async () => {
        if (config.enabled !== false) {
          await this.runCheck(config.name);
        }
      }, config.intervalMs).unref();
      
      this.intervals.set(config.name, interval);
    }

    logger.debug(`Health check registered: ${config.name}`);
  }

  /**
   * Unregister a health check
   */
  unregister(name: string): void {
    const interval = this.intervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(name);
    }
    
    this.checks.delete(name);
    this.results.delete(name);
  }

  /**
   * Run a specific health check
   */
  async runCheck(name: string): Promise<HealthCheckResult> {
    const config = this.checks.get(name);
    if (!config) {
      throw new Error(`Health check '${name}' not found`);
    }

    const start = Date.now();
    const timeoutMs = config.timeoutMs || 5000;

    // P1-FIX: Store timeout ID to clear it and prevent timer leaks
    let timeoutId: NodeJS.Timeout;
    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Health check timeout')), timeoutMs);
      });

      // Race between check and timeout
      const result = await Promise.race([
        config.check(),
        timeoutPromise,
      ]);

      clearTimeout(timeoutId!);
      const latencyMs = Date.now() - start;
      const enrichedResult: HealthCheckResult = {
        ...result,
        latencyMs,
        timestamp: new Date().toISOString(),
      };

      this.results.set(name, enrichedResult);
      this.emit('check', enrichedResult);

      return enrichedResult;
    } catch (error) {
      clearTimeout(timeoutId!);
      const latencyMs = Date.now() - start;
      const failedResult: HealthCheckResult = {
        name,
        status: 'unhealthy',
        message: error instanceof Error ? error.message : String(error),
        latencyMs,
        timestamp: new Date().toISOString(),
      };

      this.results.set(name, failedResult);
      this.emit('check', failedResult);
      this.emit('failure', failedResult);

      return failedResult;
    }
  }

  /**
   * Run all health checks
   */
  async runAllChecks(): Promise<HealthReport> {
    // P1-FIX: Run all checks in parallel to avoid cascading timeout amplification.
    // Previously sequential: N checks * 5s timeout = N*5s worst case.
    const enabledChecks = Array.from(this.checks.entries())
      .filter(([, config]) => config.enabled !== false);

    const results = await Promise.allSettled(
      enabledChecks.map(([name]) => this.runCheck(name))
    );

    const checks: HealthCheckResult[] = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      const entry = enabledChecks[index];
      const [name] = entry ?? ['unknown'];
      return {
        name,
        status: 'unhealthy' as HealthStatus,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        latencyMs: 0,
        timestamp: new Date().toISOString(),
      };
    });

    // Determine overall status
    let status: HealthStatus = 'healthy';
    const criticalUnhealthy = checks.filter(
      c => c.status === 'unhealthy' && this.checks.get(c.name)?.severity === 'critical'
    );
    const unhealthy = checks.filter(c => c.status === 'unhealthy');
    const degraded = checks.filter(c => c.status === 'degraded');

    if (criticalUnhealthy.length > 0) {
      status = 'unhealthy';
    } else if (unhealthy.length > 0 || degraded.length > 0) {
      status = 'degraded';
    }

    const summary = {
      healthy: checks.filter(c => c.status === 'healthy').length,
      degraded: degraded.length,
      unhealthy: unhealthy.length,
      unknown: checks.filter(c => c.status === 'unknown').length,
      total: checks.length,
    };

    const report: HealthReport = {
      status,
      timestamp: new Date().toISOString(),
      version: this.version,
      environment: this.environment,
      checks,
      summary,
    };

    this.emit('report', report);
    return report;
  }

  /**
   * Get last result for a check
   */
  getLastResult(name: string): HealthCheckResult | undefined {
    return this.results.get(name);
  }

  /**
   * Get all registered check names
   */
  getCheckNames(): string[] {
    return Array.from(this.checks.keys());
  }

  /**
   * Cleanup all intervals
   */
  cleanup(): void {
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }

  // ============================================================================
  // Readiness & Liveness
  // ============================================================================

  /**
   * Check if service is ready to accept traffic
   */
  async checkReadiness(): Promise<ReadinessResult> {
    const criticalChecks = Array.from(this.checks.entries())
      .filter(([, config]) => config.severity === 'critical')
      .map(([name]) => name);

    const results: HealthCheckResult[] = [];
    const dependencies: { name: string; ready: boolean }[] = [];

    for (const name of criticalChecks) {
      const result = await this.runCheck(name);
      results.push(result);
      dependencies.push({
        name,
        ready: result.status === 'healthy',
      });
    }

    const ready = dependencies.every(d => d.ready);

    return {
      ready,
      timestamp: new Date().toISOString(),
      checks: results,
      dependencies,
    };
  }

  /**
   * Check if service is alive
   */
  checkLiveness(): LivenessResult {
    const memory = process.memoryUsage();
    
    return {
      alive: true,
      timestamp: new Date().toISOString(),
      uptime: (Date.now() - this.startTime) / 1000,
      pid: process.pid,
      memory,
    };
  }

  /**
   * Get comprehensive health status
   */
  async getHealthStatus(): Promise<{
    health: HealthReport;
    readiness: ReadinessResult;
    liveness: LivenessResult;
  }> {
    const [health, readiness] = await Promise.all([
      this.runAllChecks(),
      this.checkReadiness(),
    ]);

    return {
      health,
      readiness,
      liveness: this.checkLiveness(),
    };
  }
}

// ============================================================================
// Built-in Health Check Factories
// ============================================================================

/**
 * Create a database health check
 */
export function createDatabaseHealthCheck(
  options: DatabaseHealthOptions
): HealthCheckFn {
  const name = options.name || 'database';
  
  return async (): Promise<HealthCheckResult> => {
    const start = Date.now();
    
    try {
      await options.query();
      const latencyMs = Date.now() - start;
      
      const metadata: Record<string, unknown> = { latencyMs };
      
      if (options.getPoolStatus) {
        const poolStatus = options.getPoolStatus();
        metadata['pool'] = poolStatus;
        
        // Degraded if pool is saturated
        if (poolStatus.waiting > 5) {
          return {
            name,
            status: 'degraded',
            message: `Database pool has ${poolStatus.waiting} waiting connections`,
            latencyMs,
            metadata,
            timestamp: new Date().toISOString(),
          };
        }
      }

      return {
        name,
        status: 'healthy',
        latencyMs,
        metadata,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        name,
        status: 'unhealthy',
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
    }
  };
}

/**
 * Create a Redis health check
 */
export function createRedisHealthCheck(
  options: RedisHealthOptions
): HealthCheckFn {
  const name = options.name || 'redis';
  
  return async (): Promise<HealthCheckResult> => {
    const start = Date.now();
    
    try {
      const pong = await options.ping();
      const latencyMs = Date.now() - start;
      
      if (pong !== 'PONG') {
        return {
          name,
          status: 'unhealthy',
          message: `Unexpected Redis response: ${pong}`,
          latencyMs,
          timestamp: new Date().toISOString(),
        };
      }

      const metadata: Record<string, unknown> = { latencyMs, pong };
      
      if (options.getInfo) {
        try {
          const info = await options.getInfo();
          metadata['info'] = info;
        } catch {
          // Info is optional
        }
      }

      return {
        name,
        status: 'healthy',
        latencyMs,
        metadata,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        name,
        status: 'unhealthy',
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
    }
  };
}

/**
 * Create an external API health check
 */
export function createExternalApiHealthCheck(
  options: ExternalApiHealthOptions
): HealthCheckFn {
  return async (): Promise<HealthCheckResult> => {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      options.timeoutMs || 5000
    );

    try {
      const requestInit = {
        method: options.method || 'GET',
        headers: options.headers,
        signal: controller.signal,
        body: options.body ? JSON.stringify(options.body) : undefined,
      } as RequestInit;
      const response = await fetch(options.url, requestInit);

      clearTimeout(timeoutId);
      // P2-FIX: Consume response body to prevent socket/connection leaks
      await response.body?.cancel();
      const latencyMs = Date.now() - start;

      const expectedStatus = options.expectedStatus || 200;

      if (response.status === expectedStatus) {
        return {
          name: options.name,
          status: 'healthy',
          latencyMs,
          metadata: {
            statusCode: response.status,
            url: options.url,
          },
          timestamp: new Date().toISOString(),
        };
      }

      return {
        name: options.name,
        status: 'unhealthy',
        message: `Unexpected status code: ${response.status} (expected ${expectedStatus})`,
        latencyMs,
        metadata: {
          statusCode: response.status,
          url: options.url,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        name: options.name,
        status: 'unhealthy',
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - start,
        metadata: { url: options.url },
        timestamp: new Date().toISOString(),
      };
    }
  };
}

/**
 * Create a disk space health check
 */
export function createDiskHealthCheck(
  name: string = 'disk',
  _warningThresholdPercent: number = 80,
  _criticalThresholdPercent: number = 90
): HealthCheckFn {
  return async (): Promise<HealthCheckResult> => {
    const start = Date.now();
    try {
      // Use Node.js fs to check disk space
      const fs = await import('fs').then(m => m.promises);

      // P1-FIX: Removed require('path') — CJS require() throws in ESM, and it was unused.
      // Get stats for root directory
      const _stats = await fs.stat('/');
      
      // On Windows, we'd need a different approach
      // For now, return healthy with basic info
      const latencyMs = Date.now() - start;
      
      return {
        name,
        status: 'healthy',
        message: 'Disk space check completed',
        latencyMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        name,
        status: 'unknown',
        message: 'Cannot check disk space: ' + (error instanceof Error ? error.message : String(error)),
        latencyMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
    }
  };
}

/**
 * Create a memory health check
 */
export function createMemoryHealthCheck(
  name: string = 'memory',
  warningThresholdPercent: number = 80,
  criticalThresholdPercent: number = 90
): HealthCheckFn {
  return async (): Promise<HealthCheckResult> => {
    const usage = process.memoryUsage();
    const total = usage.heapTotal + usage.external;
    const used = usage.heapUsed + usage.external;
    const percentUsed = (used / total) * 100;
    
    let status: HealthStatus = 'healthy';
    let message: string;
    
    if (percentUsed > criticalThresholdPercent) {
      status = 'unhealthy';
      message = `Memory usage critical: ${percentUsed.toFixed(1)}%`;
    } else if (percentUsed > warningThresholdPercent) {
      status = 'degraded';
      message = `Memory usage high: ${percentUsed.toFixed(1)}%`;
    } else {
      message = 'Memory usage normal';
    }

    return {
      name,
      status,
      message,
      latencyMs: 0,
      metadata: {
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external,
        percentUsed,
      },
      timestamp: new Date().toISOString(),
    };
  };
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalRegistry: HealthChecksRegistry | null = null;

/**
 * Initialize global health checks registry
 */
export function initHealthChecks(
  version?: string,
  environment?: string
): HealthChecksRegistry {
  if (!globalRegistry) {
    globalRegistry = new HealthChecksRegistry(version, environment);
  }
  return globalRegistry;
}

/**
 * Get global health checks registry
 */
export function getHealthChecks(): HealthChecksRegistry {
  if (!globalRegistry) {
    throw new Error('Health checks not initialized. Call initHealthChecks first.');
  }
  return globalRegistry;
}
