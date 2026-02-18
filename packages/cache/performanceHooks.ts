/**
 * Performance Monitoring Hooks
 * 
 * P2 OPTIMIZATION: Provides hooks for monitoring cache and query performance:
 * - Cache hit/miss tracking
 * - Query execution time tracking
 * - Memory usage monitoring
 * - Performance alerts
 */

import { MultiTierCache, CacheStats } from './multiTierCache';
import { QueryCacheStats } from './queryCache';
import { getLogger } from '@kernel/logger';

const logger = getLogger('PerformanceHooks');
const perfLogger = getLogger('PerformanceMonitor');

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface PerformanceMetrics {
  timestamp: number;
  cache: CacheStats;
  queries: QueryCacheStats;
  memory: MemoryMetrics;
  latency: LatencyMetrics;
}

export interface MemoryMetrics {
  used: number;
  total: number;
  percentUsed: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

export interface LatencyMetrics {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  avg: number;
}

export interface PerformanceAlert {
  type: 'cache' | 'query' | 'memory' | 'latency';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  metric: string;
  value: number;
  threshold: number;
  timestamp: number;
}

export interface PerformanceHookOptions {
  /** Enable automatic monitoring */
  enabled?: boolean;
  /** Sampling interval in ms */
  sampleIntervalMs?: number;
  /** Alert thresholds */
  thresholds?: {
    minCacheHitRate?: number;
    maxQueryTimeMs?: number;
    maxMemoryPercent?: number;
    maxLatencyMs?: number;
  };
  /** Callback for alerts */
  onAlert?: (alert: PerformanceAlert) => void;
  /** Callback for metrics */
  onMetrics?: (metrics: PerformanceMetrics) => void;
}

export interface LatencyHistogram {
  record(value: number): void;
  getPercentile(p: number): number;
  getAverage(): number;
  getMax(): number;
  reset(): void;
}

// ============================================================================
// Latency Histogram Implementation
// ============================================================================

export class SlidingWindowHistogram implements LatencyHistogram {
  private values: number[] = [];
  // P1-FIX: Cache the sorted copy so that consecutive getPercentile(50/95/99)
  // calls in getMetrics() each re-sort the same 1 000-element array.  The cache
  // is invalidated on every record() or reset() so results stay correct.
  private sortedCache: number[] | null = null;
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  record(value: number): void {
    this.values.push(value);
    this.sortedCache = null; // invalidate sorted cache
    if (this.values.length > this.maxSize) {
      this.values.shift();
    }
  }

  getPercentile(p: number): number {
    if (this.values.length === 0) return 0;

    if (!this.sortedCache) {
      this.sortedCache = [...this.values].sort((a, b) => a - b);
    }
    const index = Math.ceil((p / 100) * this.sortedCache.length) - 1;
    return this.sortedCache[Math.max(0, index)] ?? 0;
  }

  getAverage(): number {
    if (this.values.length === 0) return 0;
    return this.values.reduce((a, b) => a + b, 0) / this.values.length;
  }

  getMax(): number {
    if (this.values.length === 0) return 0;
    return Math.max(...this.values);
  }

  reset(): void {
    this.values = [];
    this.sortedCache = null;
  }
}

// ============================================================================
// Performance Monitor Class
// ============================================================================

export class PerformanceMonitor {
  // P1-FIX: Hard cap on recentAlerts so an alert storm (e.g. latency spikes
  // arriving faster than the 5-minute dedup window) cannot grow the array
  // without bound.  100 entries is more than sufficient for dedup purposes.
  private static readonly MAX_RECENT_ALERTS = 100;

  private enabled = false;
  private sampleIntervalId: NodeJS.Timeout | null = null;
  private latencyHistogram = new SlidingWindowHistogram();
  private recentAlerts: PerformanceAlert[] = [];
  private readonly options: Required<PerformanceHookOptions>;

  constructor(
    private cache: MultiTierCache,
    options: PerformanceHookOptions = {}
  ) {
    this.options = {
      enabled: options.enabled ?? true,
      sampleIntervalMs: options.sampleIntervalMs ?? 60000, // 1 minute
      thresholds: {
        minCacheHitRate: options.thresholds?.minCacheHitRate ?? 0.8,
        maxQueryTimeMs: options.thresholds?.maxQueryTimeMs ?? 1000,
        maxMemoryPercent: options.thresholds?.maxMemoryPercent ?? 85,
        maxLatencyMs: options.thresholds?.maxLatencyMs ?? 500,
      },
      onAlert: options.onAlert ?? (() => {}),
      onMetrics: options.onMetrics ?? (() => {}),
    };
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (this.enabled) return;
    
    this.enabled = true;
    this.sampleIntervalId = setInterval(() => {
      this.collectMetrics();
    }, this.options.sampleIntervalMs).unref();

    logger.info('Started monitoring');
    perfLogger.info('Started monitoring');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.enabled = false;
    if (this.sampleIntervalId) {
      clearInterval(this.sampleIntervalId);
      this.sampleIntervalId = null;
    }
    logger.info('Stopped monitoring');
    perfLogger.info('Stopped monitoring');
  }

  /**
   * Record operation latency
   */
  recordLatency(durationMs: number, operation?: string): void {
    if (!this.enabled) return;
    
    this.latencyHistogram.record(durationMs);

    // Check threshold
    const maxLatencyMs = this.options.thresholds.maxLatencyMs ?? 500;
    if (durationMs > maxLatencyMs) {
      this.triggerAlert({
        type: 'latency',
        severity: durationMs > maxLatencyMs * 2 ? 'critical' : 'warning',
        message: `High latency detected${operation ? ` for ${operation}` : ''}: ${durationMs.toFixed(2)}ms`,
        metric: 'latency',
        value: durationMs,
        threshold: maxLatencyMs,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Collect and report metrics
   */
  private collectMetrics(): void {
    const metrics = this.getMetrics();
    
    // Check cache performance
    const minCacheHitRate = this.options.thresholds.minCacheHitRate ?? 0.8;
    if (metrics.cache.overallHitRate < minCacheHitRate) {
      this.triggerAlert({
        type: 'cache',
        severity: 'warning',
        message: `Cache hit rate below threshold: ${(metrics.cache.overallHitRate * 100).toFixed(1)}%`,
        metric: 'cacheHitRate',
        value: metrics.cache.overallHitRate,
        threshold: minCacheHitRate,
        timestamp: Date.now(),
      });
    }

    // Check memory usage
    const maxMemoryPercent = this.options.thresholds.maxMemoryPercent ?? 85;
    if (metrics.memory.percentUsed > maxMemoryPercent) {
      this.triggerAlert({
        type: 'memory',
        severity: metrics.memory.percentUsed > 95 ? 'critical' : 'warning',
        message: `High memory usage: ${metrics.memory.percentUsed.toFixed(1)}%`,
        metric: 'memoryUsage',
        value: metrics.memory.percentUsed,
        threshold: maxMemoryPercent,
        timestamp: Date.now(),
      });
    }

    // Report metrics
    this.options.onMetrics(metrics);
  }

  /**
   * Trigger an alert
   */
  private triggerAlert(alert: PerformanceAlert): void {
    // Deduplicate similar alerts within 5 minutes
    const recentSimilar = this.recentAlerts.find(a => 
      a.type === alert.type && 
      a.metric === alert.metric &&
      alert.timestamp - a.timestamp < 5 * 60 * 1000
    );

    if (recentSimilar) return;

    this.recentAlerts.push(alert);

    // Clean alerts older than 10 minutes, then enforce hard size cap
    this.recentAlerts = this.recentAlerts.filter(
      a => alert.timestamp - a.timestamp < 10 * 60 * 1000
    );
    if (this.recentAlerts.length > PerformanceMonitor.MAX_RECENT_ALERTS) {
      this.recentAlerts = this.recentAlerts.slice(-PerformanceMonitor.MAX_RECENT_ALERTS);
    }

    this.options.onAlert(alert);
  }

  /**
   * Get current metrics
   */
  getMetrics(): PerformanceMetrics {
    return {
      timestamp: Date.now(),
      cache: this.cache.getStats(),
      queries: { // Placeholder - in real implementation would come from QueryCache
        totalQueries: 0,
        cacheHits: 0,
        cacheMisses: 0,
        hitRate: 0,
        averageQueryTimeMs: 0,
        cachedEntries: 0,
        versionKeys: 0,
        versionsCleaned: 0,
      },
      memory: this.getMemoryMetrics(),
      latency: {
        p50: this.latencyHistogram.getPercentile(50),
        p95: this.latencyHistogram.getPercentile(95),
        p99: this.latencyHistogram.getPercentile(99),
        max: this.latencyHistogram.getMax(),
        avg: this.latencyHistogram.getAverage(),
      },
    };
  }

  /**
   * Get memory metrics
   */
  private getMemoryMetrics(): MemoryMetrics {
    const usage = process.memoryUsage();
    const total = usage.heapTotal + usage.external;
    const used = usage.heapUsed + usage.external;
    
    return {
      used,
      total,
      percentUsed: total > 0 ? (used / total) * 100 : 0,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
    };
  }

  /**
   * Get latency metrics
   */
  getLatencyMetrics(): LatencyMetrics {
    return {
      p50: this.latencyHistogram.getPercentile(50),
      p95: this.latencyHistogram.getPercentile(95),
      p99: this.latencyHistogram.getPercentile(99),
      max: this.latencyHistogram.getMax(),
      avg: this.latencyHistogram.getAverage(),
    };
  }

  /**
   * Reset latency histogram
   */
  resetLatency(): void {
    this.latencyHistogram.reset();
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(): PerformanceAlert[] {
    return [...this.recentAlerts];
  }

  /**
   * Check if monitoring is active
   */
  isActive(): boolean {
    return this.enabled;
  }
}

// ============================================================================
// React Hook for Performance Monitoring
// ============================================================================

export interface UsePerformanceMonitoringOptions {
  /** Sample interval in ms */
  intervalMs?: number;
  /** Alert handler */
  onAlert?: (alert: PerformanceAlert) => void;
}

/**
 * React hook for performance monitoring (for use in frontend)
 */
export function createPerformanceHook(
  monitor: PerformanceMonitor,
  _options: UsePerformanceMonitoringOptions = {}
) {
  return {
    usePerformanceMetrics: () => {
      return monitor.getMetrics();
    },
    useLatencyReport: () => {
      return monitor.getLatencyMetrics();
    },
    recordRenderTime: (componentName: string, durationMs: number) => {
      monitor.recordLatency(durationMs, `render:${componentName}`);
    },
  };
}

// ============================================================================
// Performance Tracking Decorator
// ============================================================================

export function TrackPerformance(
  monitor: PerformanceMonitor,
  operationName?: string
) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const name = operationName || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: unknown[]) {
      const startTime = performance.now();
      
      try {
        return await originalMethod.apply(this, args);
      } finally {
        const duration = performance.now() - startTime;
        monitor.recordLatency(duration, name);
      }
    };

    return descriptor;
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

export function formatBytes(bytes: number): string {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}µs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function generatePerformanceReport(metrics: PerformanceMetrics): string {
  return `
Performance Report - ${new Date(metrics.timestamp).toISOString()}
================================================

Cache Statistics:
  - L1 Hit Rate: ${(metrics.cache.l1HitRate * 100).toFixed(1)}%
  - L2 Hit Rate: ${(metrics.cache.l2HitRate * 100).toFixed(1)}%
  - Overall Hit Rate: ${(metrics.cache.overallHitRate * 100).toFixed(1)}%
  - Total Requests: ${metrics.cache.totalRequests}

Query Statistics:
  - Total Queries: ${metrics.queries.totalQueries}
  - Hit Rate: ${(metrics.queries.hitRate * 100).toFixed(1)}%
  - Avg Query Time: ${metrics.queries.averageQueryTimeMs}ms

Memory Usage:
  - Heap: ${formatBytes(metrics.memory.heapUsed)} / ${formatBytes(metrics.memory.heapTotal)}
  - External: ${formatBytes(metrics.memory.external)}
  - Total Used: ${metrics.memory.percentUsed.toFixed(1)}%

Latency Distribution:
  - P50: ${formatDuration(metrics.latency.p50)}
  - P95: ${formatDuration(metrics.latency.p95)}
  - P99: ${formatDuration(metrics.latency.p99)}
  - Max: ${formatDuration(metrics.latency.max)}
  - Avg: ${formatDuration(metrics.latency.avg)}
`.trim();
}
