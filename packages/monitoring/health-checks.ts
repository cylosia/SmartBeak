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
  eventLoopLagMs?: number;
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
    // P1-FIX: Register an error handler on the EventEmitter. Without this, if any
    // listener throws an 'error' event, Node.js will crash the process (the default
    // EventEmitter behavior for unhandled 'error' events). The try/catch around
    // emit() in runCheck() guards against listener throw in user code, but the
    // 'error' event itself is a special case that bypasses that guard.
    this.on('error', (err: unknown) => {
      logger.error('HealthChecksRegistry EventEmitter error', { error: err instanceof Error ? err.message : String(err) });
    });
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
      const interval = setInterval(() => {
        if (config.enabled !== false) {
          void this.runCheck(config.name);
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
      // P1-AUDIT-FIX: Wrap emit in try/catch — a throwing listener must not crash health checks
      try { this.emit('check', enrichedResult); } catch (e) { logger.warn('Health check event listener error', { error: e }); }

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
      try { this.emit('check', failedResult); } catch (e) { logger.warn('Health check event listener error', { error: e }); }
      try { this.emit('failure', failedResult); } catch (e) { logger.warn('Health check failure listener error', { error: e }); }

      return failedResult;
    }
  }

  /**
   * Run all health checks
   */
  async runAllChecks(): Promise<HealthReport> {
    // P1-FIX: Run all checks in parallel to avoid cascading timeout amplification.
    // Previously sequential: N checks * 5s timeout = N*5s worst case.
    const enabledChecks = [...this.checks.entries()]
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

    try { this.emit('report', report); } catch (e) { logger.warn('Health report listener error', { error: e }); }
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
    return [...this.checks.keys()];
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
    const criticalChecks = [...this.checks.entries()]
      .filter(([, config]) => config.severity === 'critical')
      .map(([name]) => name);

    // P2-FIX: Fail-safe when no critical checks are registered.
    // Array.prototype.every() returns true on an empty array (vacuous truth), so
    // without this guard a misconfigured registry (all checks set to 'warning'/'info')
    // would declare the pod ready despite zero dependency verification.
    // This causes Kubernetes to route traffic to pods with dead DB/Redis connections.
    if (criticalChecks.length === 0) {
      logger.warn('checkReadiness: no critical health checks registered — pod is NOT ready (fail-safe)');
      return {
        ready: false,
        timestamp: new Date().toISOString(),
        checks: [],
        dependencies: [],
      };
    }

    // P1-AUDIT-FIX: Run critical checks in parallel (was sequential with for-await).
    // Sequential: N checks * 5s timeout = N*5s worst case (exceeds K8s probe timeout).
    // Parallel: max(timeouts) = 5s worst case.
    const settled = await Promise.allSettled(
      criticalChecks.map(name => this.runCheck(name))
    );

    const results: HealthCheckResult[] = [];
    const dependencies: { name: string; ready: boolean }[] = [];

    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      const checkName = criticalChecks[i] ?? 'unknown';
      if (outcome && outcome.status === 'fulfilled') {
        results.push(outcome.value);
        dependencies.push({ name: checkName, ready: outcome.value.status === 'healthy' });
      } else if (outcome) {
        const msg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        const failedResult: HealthCheckResult = { name: checkName, status: 'unhealthy', message: msg, latencyMs: 0, timestamp: new Date().toISOString() };
        results.push(failedResult);
        dependencies.push({ name: checkName, ready: false });
      }
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
   * P1-SECURITY-FIX: Added event loop lag detection. Previously hardcoded alive: true,
   * meaning Kubernetes liveness probes would never restart a stuck process. Now measures
   * event loop lag via setTimeout(0) and returns alive: false if lag exceeds threshold.
   */
  async checkLiveness(): Promise<LivenessResult> {
    const memory = process.memoryUsage();
    const EVENT_LOOP_LAG_THRESHOLD_MS = 5000;

    // Measure event loop lag: schedule a setTimeout(0) and measure actual delay
    const lagStart = Date.now();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const eventLoopLagMs = Date.now() - lagStart;

    return {
      alive: eventLoopLagMs < EVENT_LOOP_LAG_THRESHOLD_MS,
      timestamp: new Date().toISOString(),
      uptime: (Date.now() - this.startTime) / 1000,
      pid: process.pid,
      memory,
      eventLoopLagMs,
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
    // P1-AUDIT-FIX: Run all checks once, then derive readiness from results.
    // Previously ran runAllChecks() and checkReadiness() in parallel, which
    // executed critical checks twice (doubling DB/Redis load per probe).
    const health = await this.runAllChecks();

    // Derive readiness from already-executed results
    const criticalChecks = Array.from(this.checks.entries())
      .filter(([, config]) => config.severity === 'critical')
      .map(([name]) => name);

    const readinessChecks: HealthCheckResult[] = [];
    const dependencies: { name: string; ready: boolean }[] = [];

    for (const name of criticalChecks) {
      const result = this.results.get(name);
      if (result) {
        readinessChecks.push(result);
        dependencies.push({ name, ready: result.status === 'healthy' });
      } else {
        dependencies.push({ name, ready: false });
      }
    }

    const readiness: ReadinessResult = {
      ready: dependencies.every(d => d.ready),
      timestamp: new Date().toISOString(),
      checks: readinessChecks,
      dependencies,
    };

    return {
      health,
      readiness,
      liveness: await this.checkLiveness(),
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
 * Validate that a health check URL is safe to fetch.
 * Blocks the most common SSRF vectors: loopback, link-local (cloud metadata),
 * and RFC-1918 private ranges. This is a static/lexical check — DNS rebinding
 * is not prevented here (use @security/ssrf for full DNS-resolution protection).
 */
function validateHealthCheckUrl(url: string, name: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`createExternalApiHealthCheck [${name}]: invalid URL "${url}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`createExternalApiHealthCheck [${name}]: URL must use http: or https: (got ${parsed.protocol})`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
    throw new Error(`createExternalApiHealthCheck [${name}]: URL targets loopback — SSRF blocked`);
  }

  if (hostname === '169.254.169.254' || hostname.startsWith('169.254.')) {
    throw new Error(`createExternalApiHealthCheck [${name}]: URL targets link-local address — SSRF blocked`);
  }

  if (
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    throw new Error(`createExternalApiHealthCheck [${name}]: URL targets private IP range — SSRF blocked`);
  }
}

/**
 * Create an external API health check
 */
export function createExternalApiHealthCheck(
  options: ExternalApiHealthOptions
): HealthCheckFn {
  // P1-FIX: Validate URL at registration time so misconfigured URLs fail fast
  // at startup rather than silently on first probe. An unvalidated URL passed to
  // fetch() enables SSRF: e.g., http://169.254.169.254/latest/meta-data/ would
  // exfiltrate cloud credentials on every health check interval.
  validateHealthCheckUrl(options.url, options.name);

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
// P1-AUDIT-FIX: Rewritten to actually check disk space using fs.statfs (Node 18.15+).
// Previous implementation was a no-op: called fs.stat('/') (inode metadata), ignored
// thresholds entirely, and always returned 'healthy'.
export function createDiskHealthCheck(
  name: string = 'disk',
  warningThresholdPercent: number = 80,
  criticalThresholdPercent: number = 90
): HealthCheckFn {
  return async (): Promise<HealthCheckResult> => {
    const start = Date.now();
    try {
      const fs = await import('fs').then(m => m.promises);

      // statfs returns filesystem stats including bfree/blocks (Node 18.15+)
      if (typeof fs.statfs !== 'function') {
        return {
          name,
          status: 'unknown',
          message: 'fs.statfs not available (requires Node 18.15+)',
          latencyMs: Date.now() - start,
          timestamp: new Date().toISOString(),
        };
      }

      const stats = await fs.statfs('/');
      const totalBytes = stats.blocks * stats.bsize;
      // P1-FIX: Clamp freeBytes to [0, totalBytes]. On certain virtual filesystems
      // bfree can exceed blocks (e.g., overlayfs with quota accounting), which would
      // produce a negative usedPercent and report the disk as "healthy" when it is
      // actually at capacity. Math.min prevents freeBytes > totalBytes; Math.max
      // prevents a negative result if bfree is somehow reported as a large integer.
      const freeBytes = Math.min(Math.max(stats.bfree * stats.bsize, 0), totalBytes);
      const usedPercent = totalBytes > 0 ? ((totalBytes - freeBytes) / totalBytes) * 100 : 0;
      const latencyMs = Date.now() - start;

      let status: HealthStatus = 'healthy';
      let message = `Disk usage: ${usedPercent.toFixed(1)}%`;

      if (usedPercent >= criticalThresholdPercent) {
        status = 'unhealthy';
        message = `Disk usage critical: ${usedPercent.toFixed(1)}% (threshold: ${criticalThresholdPercent}%)`;
      } else if (usedPercent >= warningThresholdPercent) {
        status = 'degraded';
        message = `Disk usage high: ${usedPercent.toFixed(1)}% (threshold: ${warningThresholdPercent}%)`;
      }

      return {
        name,
        status,
        message,
        latencyMs,
        metadata: {
          totalBytes,
          freeBytes,
          usedPercent,
        },
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
// P1-AUDIT-FIX: Rewritten to use RSS vs container memory limit instead of V8 heap percentage.
// Previous calculation used heapTotal+external as "total" — but V8 dynamically grows heapTotal,
// so the percentage stayed low even as absolute memory grew toward OOM.
export function createMemoryHealthCheck(
  name: string = 'memory',
  warningThresholdPercent: number = 80,
  criticalThresholdPercent: number = 90
): HealthCheckFn {
  // Try to detect container memory limit at registration time
  let containerLimitBytes: number | null = null;
  const memLimitEnv = process.env['MEMORY_LIMIT'];
  if (memLimitEnv) {
    containerLimitBytes = parseInt(memLimitEnv, 10);
  }
  // Fallback: try cgroup v2 then v1 limit files (async on first call)
  let cgroupLimitChecked = false;

  return async (): Promise<HealthCheckResult> => {
    const usage = process.memoryUsage();

    // Attempt cgroup detection once
    if (!containerLimitBytes && !cgroupLimitChecked) {
      cgroupLimitChecked = true;
      try {
        const fs = await import('fs').then(m => m.promises);
        // cgroup v2
        const v2 = await fs.readFile('/sys/fs/cgroup/memory.max', 'utf-8').catch(() => null);
        if (v2 && v2.trim() !== 'max') {
          containerLimitBytes = parseInt(v2.trim(), 10);
        } else {
          // cgroup v1
          const v1 = await fs.readFile('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf-8').catch(() => null);
          if (v1) {
            const parsed = parseInt(v1.trim(), 10);
            // Ignore absurdly large values (unbounded)
            if (parsed < 1024 * 1024 * 1024 * 100) { // < 100GB
              containerLimitBytes = parsed;
            }
          }
        }
      } catch {
        // Not in a container or no cgroup access
      }
    }

    // Use container limit if available, otherwise os.totalmem()
    const os = await import('os');
    const totalMemory = containerLimitBytes || os.totalmem();
    const rss = usage.rss;
    const percentUsed = totalMemory > 0 ? (rss / totalMemory) * 100 : 0;

    let status: HealthStatus = 'healthy';
    let message: string;

    if (percentUsed > criticalThresholdPercent) {
      status = 'unhealthy';
      message = `Memory usage critical: ${percentUsed.toFixed(1)}% (RSS: ${(rss / 1024 / 1024).toFixed(0)}MB)`;
    } else if (percentUsed > warningThresholdPercent) {
      status = 'degraded';
      message = `Memory usage high: ${percentUsed.toFixed(1)}% (RSS: ${(rss / 1024 / 1024).toFixed(0)}MB)`;
    } else {
      message = `Memory usage normal: ${percentUsed.toFixed(1)}%`;
    }

    return {
      name,
      status,
      message,
      latencyMs: 0,
      metadata: {
        rss: usage.rss,
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external,
        totalMemory,
        percentUsed,
        source: containerLimitBytes ? 'container_limit' : 'os_total',
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

/**
 * Reset global health checks registry
 * P2-TESTABILITY-FIX: Allows tests to reset the singleton between test cases
 * to prevent shared state leaking between tests.
 */
export function resetHealthChecks(): void {
  globalRegistry?.cleanup();
  globalRegistry = null;
}
