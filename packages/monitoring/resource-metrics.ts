/**
 * Resource Metrics Collector
 *
 * Collects infrastructure-level metrics for queues, retries, circuit breakers,
 * and rate limiters. Uses two mechanisms:
 * 1. Polling — periodically reads queue state via BullMQ getJobCounts()
 * 2. Hooks — kernel code calls exported hook functions on each event
 *
 * The hook pattern avoids a circular dependency: kernel never imports monitoring.
 * Instead, monitoring calls kernel's setXxxMetricsHook() during initialization.
 */

import { getLogger } from '@kernel/logger';

import { getMetricsCollector } from './metrics-collector';

const logger = getLogger('resource-metrics');

// ============================================================================
// Types
// ============================================================================

export interface ResourceMetricsConfig {
  /** Polling interval for queue metrics in ms (default: 30000) */
  pollingIntervalMs?: number;
}

export interface QueueRef {
  getJobCounts: () => Promise<Record<string, number>>;
}

// ============================================================================
// Resource Metrics Collector
// ============================================================================

export class ResourceMetricsCollector {
  private readonly pollingIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly queues = new Map<string, QueueRef>();

  constructor(config: ResourceMetricsConfig = {}) {
    this.pollingIntervalMs = config.pollingIntervalMs ?? 30000;
  }

  /**
   * Register a BullMQ queue for depth polling
   */
  registerQueue(name: string, queue: QueueRef): void {
    this.queues.set(name, queue);
  }

  /**
   * Start periodic queue polling
   */
  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.pollQueues().catch(err => {
        logger.warn('Queue polling failed', { error: err instanceof Error ? err.message : String(err) });
      });
    }, this.pollingIntervalMs);

    // Allow process to exit even if timer is running
    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }

    logger.info('Resource metrics collector started', { pollingIntervalMs: this.pollingIntervalMs });
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async pollQueues(): Promise<void> {
    const collector = getMetricsCollector();

    for (const [name, queue] of this.queues) {
      try {
        const counts = await queue.getJobCounts();
        const active = counts['active'] ?? 0;
        const waiting = counts['waiting'] ?? 0;
        const delayed = counts['delayed'] ?? 0;
        const failed = counts['failed'] ?? 0;
        const completed = counts['completed'] ?? 0;

        collector.gauge('resource.queue.depth', active + waiting + delayed, { queue: name });
        collector.gauge('resource.queue.active', active, { queue: name });
        collector.gauge('resource.queue.waiting', waiting, { queue: name });
        collector.gauge('resource.queue.delayed', delayed, { queue: name });
        collector.counter('resource.queue.failed_total', failed, { queue: name });
        collector.counter('resource.queue.completed_total', completed, { queue: name });
      } catch (err) {
        logger.warn(`Failed to poll queue '${name}'`, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ResourceMetricsCollector | null = null;

export function initResourceMetrics(config?: ResourceMetricsConfig): ResourceMetricsCollector {
  instance = new ResourceMetricsCollector(config);

  // Wire hooks into kernel code using dynamic import() (ESM-compliant).
  // Previously used CJS require() which throws at runtime in ESM modules
  // ("type": "module" in package.json). Dynamic import() is the ESM equivalent
  // and is fire-and-forget here intentionally — failures are logged as warnings
  // because metrics hooks are non-critical observability infrastructure.
  void import('@kernel/retry').then((retry) => {
    if (typeof retry['setRetryMetricsHook'] === 'function') {
      retry['setRetryMetricsHook']({
        onAttempt: recordRetryAttempt,
        onExhaustion: recordRetryExhaustion,
      });
    }
    if (typeof retry['setCircuitBreakerMetricsHook'] === 'function') {
      retry['setCircuitBreakerMetricsHook']({
        onStateChange: recordCircuitBreakerStateChange,
        onExecution: recordCircuitBreakerExecution,
        onRejection: recordCircuitBreakerRejection,
      });
    }
  }).catch(() => {
    logger.warn('Could not wire retry/circuit breaker metrics hooks');
  });

  void import('@kernel/rateLimiterRedis').then((rateLimiter) => {
    if (typeof rateLimiter['setRateLimitMetricsHook'] === 'function') {
      rateLimiter['setRateLimitMetricsHook'](recordRateLimitCheck);
    }
  }).catch(() => {
    logger.warn('Could not wire rate limit metrics hook');
  });

  return instance;
}

export function getResourceMetrics(): ResourceMetricsCollector {
  if (!instance) {
    throw new Error('ResourceMetricsCollector not initialized. Call initResourceMetrics() first.');
  }
  return instance;
}

// ============================================================================
// Hook Functions — called from kernel code via setXxxMetricsHook()
// ============================================================================

/**
 * Record a retry attempt with backoff delay
 */
export function recordRetryAttempt(operation: string, attempt: number, delayMs: number): void {
  try {
    const collector = getMetricsCollector();
    collector.counter('resource.retry.attempts_total', 1, { operation });
    collector.histogram('resource.retry.delay_ms', delayMs, { operation });
  } catch {
    // Metrics not initialized yet — silently drop
  }
}

/**
 * Bucket a raw attempt count into a bounded label value to prevent cardinality
 * explosion in Prometheus. Using exact counts (e.g. "47") as labels creates an
 * unbounded number of time-series: with maxRetries=100 across 50 operations you
 * get 5,000 label combinations that exhaust scraper memory and slow queries.
 */
function bucketAttempts(totalAttempts: number): string {
  if (totalAttempts <= 3) return '1-3';
  if (totalAttempts <= 10) return '4-10';
  if (totalAttempts <= 30) return '11-30';
  return '31+';
}

/**
 * Record all retries exhausted for an operation
 */
export function recordRetryExhaustion(operation: string, totalAttempts: number): void {
  try {
    const collector = getMetricsCollector();
    // P1-FIX: Bucket attempt counts instead of using exact values as labels.
    // Exact counts create unbounded label cardinality and Prometheus OOM risk.
    collector.counter('resource.retry.exhausted_total', 1, { operation, attempt_bucket: bucketAttempts(totalAttempts) });
  } catch {
    // Metrics not initialized yet — silently drop
  }
}

/**
 * Record a circuit breaker state transition
 */
export function recordCircuitBreakerStateChange(name: string, fromState: string, toState: string): void {
  try {
    const collector = getMetricsCollector();
    const stateValues: Record<string, number> = { 'closed': 0, 'half-open': 0.5, 'open': 1 };
    collector.gauge('resource.circuit_breaker.state', stateValues[toState] ?? 0, { name });
    collector.counter('resource.circuit_breaker.transitions_total', 1, { name, from: fromState, to: toState });
  } catch {
    // Metrics not initialized yet — silently drop
  }
}

/**
 * Record a circuit breaker execution attempt
 */
export function recordCircuitBreakerExecution(name: string, success: boolean, durationMs: number): void {
  try {
    const collector = getMetricsCollector();
    collector.counter('resource.circuit_breaker.executions_total', 1, { name, result: success ? 'success' : 'failure' });
    collector.histogram('resource.circuit_breaker.execution_duration_ms', durationMs, { name });
  } catch {
    // Metrics not initialized yet — silently drop
  }
}

/**
 * Record a circuit breaker rejection (circuit is open)
 */
export function recordCircuitBreakerRejection(name: string): void {
  try {
    const collector = getMetricsCollector();
    collector.counter('resource.circuit_breaker.rejections_total', 1, { name });
  } catch {
    // Metrics not initialized yet — silently drop
  }
}

/**
 * Record a rate limit check result
 */
export function recordRateLimitCheck(key: string, allowed: boolean, remaining: number, limit: number): void {
  try {
    const collector = getMetricsCollector();
    collector.counter('resource.rate_limit.checks_total', 1, { result: allowed ? 'allowed' : 'denied' });
    const utilization = limit > 0 ? 1 - (remaining / limit) : 0;
    // P1-FIX: Do NOT include `key` as a metric label. Rate-limit keys are often
    // per-user or per-IP identifiers (e.g. "user:abc-123", "1.2.3.4") which
    // create unbounded cardinality — potentially millions of label values in
    // production. This causes Prometheus to OOM and makes metric scraping fail.
    // Aggregate utilization across all keys; use logs for per-key debugging.
    collector.gauge('resource.rate_limit.utilization', utilization);
    // `key` parameter is intentionally unused for cardinality reasons above.
    void key;
  } catch {
    // Metrics not initialized yet — silently drop
  }
}
