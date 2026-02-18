/**
 * Comprehensive Metrics Collection Module
 * 
 * Collects and aggregates:
 * - Business metrics (user signups, payments, etc.)
 * - System metrics (CPU, memory, event loop lag)
 * - Custom metrics for critical paths
 * 
 * MEMORY LEAK FIX: Added LRU eviction for metrics map with max 10000 keys
 * and monitoring/alerting for cache sizes.
 */

import { EventEmitter } from 'events';
import os from 'os';
import { getLogger } from '@kernel/logger';
import { Pool } from 'pg';

const logger = getLogger('metrics-collector');

// ============================================================================
// Constants for Memory Leak Prevention
// ============================================================================

/** Maximum number of metric keys to prevent unbounded memory growth */
const MAX_METRIC_KEYS = 10000;

/** High watermark threshold for alerting (80% of max) */
const KEY_ALERT_THRESHOLD = 0.8;

/** Alert interval in milliseconds (5 minutes) */
const ALERT_INTERVAL_MS = 300000;

/** Threshold for using approximation algorithms */
const APPROXIMATION_THRESHOLD = 10000;

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Metric value types
 */
export type MetricValue = number | string | boolean;

/**
 * Metric types
 */
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

/**
 * Metric definition
 */
export interface Metric {
  name: string;
  type: MetricType;
  value: MetricValue;
  labels?: Record<string, string> | undefined;
  timestamp: number;
  description?: string | undefined;
  unit?: string | undefined;
}

/**
 * Business metric categories
 */
export interface BusinessMetrics {
  userSignups: number;
  userLogins: number;
  paymentsProcessed: number;
  revenueAmount: number;
  contentPublished: number;
  jobsCompleted: number;
  jobsFailed: number;
  apiCalls: number;
}

/**
 * System metrics snapshot
 */
export interface SystemMetrics {
  cpu: {
    usagePercent: number;
    loadAverage: number[];
    count: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
  eventLoop: {
    lagMs: number;
    utilization: number;
  };
  uptime: number;
}

/**
 * Metric aggregation configuration
 */
export interface AggregationConfig {
  /** Aggregation interval in milliseconds */
  intervalMs: number;
  /** Retention period in milliseconds */
  retentionMs: number;
  /** Enable percentile calculations */
  percentiles: number[];
  /** Maximum number of metric keys (LRU eviction) */
  maxKeys?: number;
  /** Enable size monitoring and alerting */
  enableSizeMonitoring?: boolean;
  /** Enable O(n) approximation for large datasets (default: true) */
  enableApproximation?: boolean;
  /** Threshold for using approximation (default: 10000) */
  approximationThreshold?: number;
}

/**
 * Aggregated metric data
 */
export interface AggregatedMetric {
  name: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  percentiles?: Record<string, number>;
  lastUpdated: number;
}

/**
 * Metrics collector statistics for monitoring
 */
export interface MetricsCollectorStats {
  totalKeys: number;
  totalMetrics: number;
  aggregationsCount: number;
  keysEvicted: number;
  lastAlertTime?: number;
}

// ============================================================================
// Metrics Collector Class
// ============================================================================

export class MetricsCollector extends EventEmitter {
  private readonly metrics: Map<string, Metric[]> = new Map();
  private readonly aggregations: Map<string, AggregatedMetric> = new Map();
  private readonly config: Required<AggregationConfig>;
  private readonly db: Pool | undefined;
  private collectionInterval: NodeJS.Timeout | undefined;
  private eventLoopLagInterval: NodeJS.Timeout | undefined;
  private lastEventLoopTime: number = 0;
  
  // P1-3 FIX: LRU tracking uses Map (O(1) delete+set) instead of array (O(n) indexOf+splice)
  private readonly keyAccessOrder = new Map<string, true>();
  private keysEvicted = 0;
  private lastAlertTime = 0;
  // P2-6 FIX: Store previous CPU reading for delta-based calculation
  private previousCpuUsage: { user: number; system: number; timestamp: number } | null = null;

  constructor(
    config: Partial<AggregationConfig> = {},
    db?: Pool
  ) {
    super();
    // P1-30 FIX: Increase max listeners to prevent EventEmitter warnings
    // when multiple consumers attach metric/aggregation/keysEvicted listeners
    this.setMaxListeners(50);

    this.config = {
      intervalMs: config.intervalMs || 60000,
      retentionMs: config.retentionMs || 3600000, // 1 hour
      percentiles: config.percentiles || [50, 90, 95, 99],
      maxKeys: config.maxKeys || MAX_METRIC_KEYS,
      enableSizeMonitoring: config.enableSizeMonitoring ?? true,
      enableApproximation: config.enableApproximation ?? true,
      approximationThreshold: config.approximationThreshold || APPROXIMATION_THRESHOLD,
    };
    
    this.db = db;
    this.lastEventLoopTime = Date.now();
  }

  /**
   * Start metrics collection
   */
  start(): void {
    if (this.collectionInterval) {
      return;
    }

    // Start system metrics collection
    this.collectionInterval = setInterval(() => {
      this.collectSystemMetrics();
      this.aggregateMetrics();
      if (this.config.enableSizeMonitoring) {
        this.monitorCacheSize();
      }
    }, this.config.intervalMs).unref();

    // Start event loop lag monitoring
    this.monitorEventLoopLag();

    logger.info('Metrics collector started', { 
      intervalMs: this.config.intervalMs,
      maxKeys: this.config.maxKeys,
    });
  }

  /**
   * Stop metrics collection
   */
  stop(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = undefined;
    }
    if (this.eventLoopLagInterval) {
      clearInterval(this.eventLoopLagInterval);
      this.eventLoopLagInterval = undefined;
    }
    // P0-7 FIX: Remove all event listeners to prevent memory leaks
    this.removeAllListeners();
    logger.info('Metrics collector stopped');
  }

  // ============================================================================
  // Memory Leak Prevention: LRU Eviction
  // ============================================================================

  /**
   * Update key access order for LRU tracking
   * P1-3 FIX: Uses Map (O(1) delete + set) instead of array indexOf/splice (O(n))
   */
  private touchKey(key: string): void {
    // Delete and re-insert to move to end (most recently used)
    this.keyAccessOrder.delete(key);
    this.keyAccessOrder.set(key, true);
  }

  /**
   * Evict oldest keys when limit is exceeded
   */
  private evictOldestKeysIfNeeded(): void {
    if (this.metrics.size <= this.config.maxKeys) {
      return;
    }

    const keysToEvict = this.metrics.size - this.config.maxKeys;
    let evicted = 0;

    // Evict oldest keys (from beginning of Map iteration order)
    const iter = this.keyAccessOrder.keys();
    for (let i = 0; i < keysToEvict; i++) {
      const { value: oldestKey, done } = iter.next();
      if (done) break;
      this.keyAccessOrder.delete(oldestKey);
      if (this.metrics.has(oldestKey)) {
        this.metrics.delete(oldestKey);
        this.aggregations.delete(oldestKey);
        evicted++;
      }
    }

    if (evicted > 0) {
      this.keysEvicted += evicted;
      logger.warn('Metrics collector evicted old keys due to size limit', {
        evicted,
        totalEvicted: this.keysEvicted,
        currentSize: this.metrics.size,
        maxKeys: this.config.maxKeys,
      });
      this.emit('keysEvicted', { evicted, totalEvicted: this.keysEvicted });
    }
  }

  /**
   * Monitor cache size and alert if approaching limits
   */
  private monitorCacheSize(): void {
    const keyCount = this.metrics.size;
    const utilization = keyCount / this.config.maxKeys;
    const now = Date.now();

    // Record internal metrics
    this.gauge('metrics.collector.keys', keyCount, {}, 'Number of metric keys');
    this.gauge('metrics.collector.utilization', utilization * 100, {}, 'Key space utilization %');
    this.gauge('metrics.collector.evicted', this.keysEvicted, {}, 'Total keys evicted');

    // Alert if above threshold and not alerted recently
    if (utilization >= KEY_ALERT_THRESHOLD && 
        (now - this.lastAlertTime) > ALERT_INTERVAL_MS) {
      this.lastAlertTime = now;
      logger.error('Metrics collector approaching key limit', undefined, {
        keyCount,
        maxKeys: this.config.maxKeys,
        utilization: `${(utilization * 100).toFixed(1)}%`,
        threshold: `${(KEY_ALERT_THRESHOLD * 100).toFixed(1)}%`,
      });
      this.emit('highKeyCount', {
        keyCount,
        maxKeys: this.config.maxKeys,
        utilization,
      });
    }
  }

  // ============================================================================
  // Metric Recording
  // ============================================================================

  /**
   * Record a counter metric
   */
  counter(
    name: string,
    value: number = 1,
    labels?: Record<string, string>,
    description?: string
  ): void {
    const metric: Metric = {
      name,
      type: 'counter',
      value,
      timestamp: Date.now(),
    };
    if (labels !== undefined) metric.labels = labels;
    if (description !== undefined) metric.description = description;
    this.record(metric);
  }

  /**
   * Record a gauge metric
   */
  gauge(
    name: string,
    value: number,
    labels?: Record<string, string>,
    description?: string,
    unit?: string
  ): void {
    const metric: Metric = {
      name,
      type: 'gauge',
      value,
      timestamp: Date.now(),
    };
    if (labels !== undefined) metric.labels = labels;
    if (description !== undefined) metric.description = description;
    if (unit !== undefined) metric.unit = unit;
    this.record(metric);
  }

  /**
   * Record a histogram value
   */
  histogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
    description?: string
  ): void {
    const metric: Metric = {
      name,
      type: 'histogram',
      value,
      timestamp: Date.now(),
    };
    if (labels !== undefined) metric.labels = labels;
    if (description !== undefined) metric.description = description;
    this.record(metric);
  }

  /**
   * Record a timing metric
   */
  timing(
    name: string,
    durationMs: number,
    labels?: Record<string, string>,
    description?: string
  ): void {
    this.histogram(`${name}_duration_ms`, durationMs, labels, description);
  }

  /**
   * Record a metric
   */
  record(metric: Metric): void {
    const key = this.getMetricKey(metric.name, metric.labels);
    
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }

    // Update LRU order
    this.touchKey(key);

    // Evict old keys if needed (memory leak prevention)
    this.evictOldestKeysIfNeeded();

    const metrics = this.metrics.get(key)!;
    metrics.push(metric);

    // FIX(P2): Replace O(k·n) shift() loop with O(n) findIndex + single splice.
    // Array.shift() is O(n) per call (moves every element left); repeating it k
    // times for k expired entries costs O(k·n). findIndex scans once (O(n)) and
    // splice(0, k) removes in one operation (O(n)), so total cost is O(n).
    const cutoff = Date.now() - this.config.retentionMs;
    const firstValidIndex = metrics.findIndex(m => m.timestamp >= cutoff);
    if (firstValidIndex === -1) {
      metrics.splice(0); // All entries expired
    } else if (firstValidIndex > 0) {
      metrics.splice(0, firstValidIndex);
    }

    // Emit for real-time processing
    this.emit('metric', metric);
  }

  // ============================================================================
  // Business Metrics
  // ============================================================================

  /**
   * Record user signup
   */
  recordUserSignup(source?: string): void {
    this.counter('business.user_signups', 1, { source: source || 'unknown' });
  }

  /**
   * Record user login
   */
  recordUserLogin(success: boolean, method: string): void {
    this.counter('business.user_logins', 1, { 
      status: success ? 'success' : 'failed',
      method 
    });
  }

  /**
   * Record payment processed
   */
  recordPayment(amount: number, currency: string, status: string): void {
    this.counter('business.payments_processed', 1, { 
      currency, 
      status 
    });
    this.gauge('business.revenue_amount', amount, { currency }, 
      'Total revenue amount', currency);
  }

  /**
   * Record content published
   */
  recordContentPublished(contentType: string, platform?: string): void {
    this.counter('business.content_published', 1, { 
      content_type: contentType,
      platform: platform || 'none'
    });
  }

  /**
   * Record job completion
   */
  recordJobCompleted(jobType: string, durationMs: number): void {
    this.counter('business.jobs_completed', 1, { job_type: jobType });
    this.timing('business.job_duration', durationMs, { job_type: jobType });
  }

  /**
   * Record job failure
   */
  recordJobFailed(jobType: string, errorType: string): void {
    this.counter('business.jobs_failed', 1, { 
      job_type: jobType,
      error_type: errorType
    });
  }

  /**
   * Record API call
   * P0-14 FIX: Normalizes endpoint paths to prevent high-cardinality metric explosion
   */
  recordApiCall(
    endpoint: string,
    method: string,
    statusCode: number,
    durationMs: number
  ): void {
    const normalizedEndpoint = this.normalizeEndpoint(endpoint);
    this.counter('business.api_calls', 1, {
      endpoint: normalizedEndpoint,
      method,
      status: `${statusCode}`,
    });
    this.timing('business.api_duration', durationMs, {
      endpoint: normalizedEndpoint,
      method,
    });
  }

  /**
   * P0-14 FIX: Normalize endpoint paths by replacing dynamic segments
   * (UUIDs, numeric IDs, etc.) with placeholders to prevent high-cardinality labels.
   *
   * Examples:
   *   /api/users/abc-123-def        -> /api/users/:id
   *   /api/orgs/42/members/99       -> /api/orgs/:id/members/:id
   *   /api/content/550e8400-e29b... -> /api/content/:id
   */
  private normalizeEndpoint(endpoint: string): string {
    return endpoint
      .split('/')
      .map(segment => {
        if (segment === '') return segment;
        // UUID pattern (with or without hyphens)
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
          return ':id';
        }
        // Hex string IDs (24+ chars, e.g. MongoDB ObjectIds)
        if (/^[0-9a-f]{24,}$/i.test(segment)) {
          return ':id';
        }
        // Pure numeric IDs
        if (/^\d+$/.test(segment)) {
          return ':id';
        }
        // UUID-like slugs (alphanumeric with hyphens, containing digits)
        if (/^[a-zA-Z0-9]+-[a-zA-Z0-9-]+$/.test(segment) && /\d/.test(segment) && segment.length > 8) {
          return ':id';
        }
        return segment;
      })
      .join('/');
  }

  // ============================================================================
  // System Metrics Collection
  // ============================================================================

  /**
   * Collect system metrics
   */
  private collectSystemMetrics(): void {
    // CPU metrics
    const cpuUsage = process.cpuUsage();
    const loadAvg = os.loadavg();
    
    this.gauge('system.cpu.user', cpuUsage.user / 1000, {}, 
      'CPU user time in milliseconds');
    this.gauge('system.cpu.system', cpuUsage.system / 1000, {},
      'CPU system time in milliseconds');
    this.gauge('system.cpu.load_average_1m', loadAvg[0] ?? 0, {},
      '1 minute load average');
    this.gauge('system.cpu.load_average_5m', loadAvg[1] ?? 0, {},
      '5 minute load average');
    this.gauge('system.cpu.load_average_15m', loadAvg[2] ?? 0, {},
      '15 minute load average');
    this.gauge('system.cpu.count', os.cpus().length, {},
      'Number of CPU cores');

    // Memory metrics
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = process.memoryUsage();

    this.gauge('system.memory.total', totalMem, {},
      'Total system memory in bytes', 'bytes');
    this.gauge('system.memory.free', freeMem, {},
      'Free system memory in bytes', 'bytes');
    this.gauge('system.memory.used', usedMem, {},
      'Used system memory in bytes', 'bytes');
    this.gauge('system.memory.used_percent', (usedMem / totalMem) * 100, {},
      'System memory usage percentage', 'percent');
    
    // Node.js specific memory
    this.gauge('system.memory.heap_total', memUsage.heapTotal, {},
      'V8 heap total size', 'bytes');
    this.gauge('system.memory.heap_used', memUsage.heapUsed, {},
      'V8 heap used size', 'bytes');
    this.gauge('system.memory.external', memUsage.external, {},
      'External memory usage', 'bytes');
    this.gauge('system.memory.array_buffers', memUsage.arrayBuffers || 0, {},
      'Array buffer memory', 'bytes');

    // Uptime
    this.gauge('system.uptime', process.uptime(), {},
      'Process uptime in seconds', 'seconds');
  }

  /**
   * Monitor event loop lag
   */
  private monitorEventLoopLag(): void {
    const measureLag = () => {
      const now = Date.now();
      const lag = now - this.lastEventLoopTime - 100;
      
      if (this.lastEventLoopTime > 0) {
        this.gauge('system.event_loop.lag_ms', Math.max(0, lag), {},
          'Event loop lag in milliseconds', 'milliseconds');
      }
      
      this.lastEventLoopTime = now;
    };

    this.eventLoopLagInterval = setInterval(measureLag, 100).unref();
  }

  /**
   * Get current system metrics snapshot
   */
  getSystemMetrics(): SystemMetrics {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const now = Date.now();
    const cpuCount = os.cpus().length;

    // P2-6 FIX: Compute CPU % from delta between readings, not cumulative total
    let cpuPercent = 0;
    if (this.previousCpuUsage) {
      const elapsedMs = now - this.previousCpuUsage.timestamp;
      if (elapsedMs > 0) {
        const userDelta = cpuUsage.user - this.previousCpuUsage.user;
        const systemDelta = cpuUsage.system - this.previousCpuUsage.system;
        // cpuUsage is in microseconds, elapsedMs in milliseconds
        cpuPercent = ((userDelta + systemDelta) / 1000 / elapsedMs / cpuCount) * 100;
      }
    }
    this.previousCpuUsage = { user: cpuUsage.user, system: cpuUsage.system, timestamp: now };

    return {
      cpu: {
        usagePercent: cpuPercent,
        loadAverage: os.loadavg(),
        count: cpuCount,
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem,
        usedPercent: ((totalMem - freeMem) / totalMem) * 100,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers || 0,
      },
      eventLoop: {
        lagMs: this.getLatestMetricValue('system.event_loop.lag_ms') || 0,
        utilization: 0, // Would need more complex calculation
      },
      uptime: process.uptime(),
    };
  }

  // ============================================================================
  // Metric Aggregation
  // ============================================================================

  /**
   * Aggregate metrics
   * P1-FIX: Uses O(n) approximation for large datasets instead of O(n log n) sort
   */
  private aggregateMetrics(): void {
    for (const [key, metrics] of this.metrics) {
      if (metrics.length === 0) continue;

      const numericMetrics = metrics.filter(
        m => typeof m.value === 'number'
      ) as Array<Metric & { value: number }>;

      if (numericMetrics.length === 0) continue;

      const values = numericMetrics.map(m => m.value);
      const sum = values.reduce((a, b) => a + b, 0);
      const count = values.length;

      // P1-FIX: Use approximation for large datasets
      let min: number, max: number, percentiles: Record<string, number>;
      
      if (this.config.enableApproximation && count > this.config.approximationThreshold) {
        // O(n) approximation using quickselect and reservoir sampling
        const approx = this.approximateStats(values);
        min = approx.min;
        max = approx.max;
        percentiles = approx.percentiles;
      } else {
        // O(n log n) exact calculation for small datasets
        const sorted = [...values].sort((a, b) => a - b);
        min = sorted[0]!;
        max = sorted[sorted.length - 1]!;
        percentiles = {};
        for (const p of this.config.percentiles) {
          const index = Math.ceil((p / 100) * sorted.length) - 1;
          percentiles[`p${p}`] = sorted[Math.max(0, index)]!;
        }
      }

      const aggregation: AggregatedMetric = {
        name: metrics[0]!.name,
        count,
        sum,
        min,
        max,
        avg: sum / count,
        percentiles,
        lastUpdated: Date.now(),
      };

      this.aggregations.set(key, aggregation);
    }

    this.emit('aggregation', this.aggregations);
  }

  /**
   * P1-FIX: O(n) approximate statistics using QuickSelect algorithm
   * Much faster than full sort for large datasets
   */
  private approximateStats(values: number[]): { min: number; max: number; percentiles: Record<string, number> } {
    const percentiles: Record<string, number> = {};

    // P2-9 FIX: Use a single copy for all percentile calculations instead of
    // copying the array once per percentile. Sort the target indices ascending
    // and compute them in order on the same working copy.
    const work = [...values];
    const targets = this.config.percentiles
      .map(p => ({ p, k: Math.floor((p / 100) * values.length) }))
      .sort((a, b) => a.k - b.k);

    for (const { p, k } of targets) {
      percentiles[`p${p}`] = this.quickSelect(work, k);
    }

    // O(n) min/max
    let min = values[0]!;
    let max = values[0]!;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }

    return { min, max, percentiles };
  }

  /**
   * P1-FIX: QuickSelect algorithm for O(n) percentile calculation
   * Finds the k-th smallest element without full sort
   * P1-7 FIX: Uses in-place partitioning with swaps instead of filter/splice
   * which created new arrays on each recursive call
   */
  private quickSelect(arr: number[], k: number, left = 0, right = arr.length - 1): number {
    if (left === right) return arr[left]!;

    // Choose a random pivot and move it to the end
    const pivotIndex = left + Math.floor(Math.random() * (right - left + 1));
    const pivotValue = arr[pivotIndex]!;
    // Swap pivot to end
    arr[pivotIndex] = arr[right]!;
    arr[right] = pivotValue;

    // Partition in-place
    let storeIndex = left;
    for (let i = left; i < right; i++) {
      if (arr[i]! < pivotValue) {
        // Swap arr[i] and arr[storeIndex]
        const tmp = arr[i]!;
        arr[i] = arr[storeIndex]!;
        arr[storeIndex] = tmp;
        storeIndex++;
      }
    }
    // Move pivot to its final position
    arr[right] = arr[storeIndex]!;
    arr[storeIndex] = pivotValue;

    if (k === storeIndex) {
      return pivotValue;
    } else if (k < storeIndex) {
      return this.quickSelect(arr, k, left, storeIndex - 1);
    } else {
      return this.quickSelect(arr, k, storeIndex + 1, right);
    }
  }

  /**
   * Get aggregated metric
   */
  getAggregation(name: string, labels?: Record<string, string>): AggregatedMetric | undefined {
    const key = this.getMetricKey(name, labels);
    return this.aggregations.get(key);
  }

  /**
   * Get all aggregations
   */
  getAllAggregations(): Map<string, AggregatedMetric> {
    return new Map(this.aggregations);
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Get latest metric value
   */
  getLatestMetricValue(name: string, labels?: Record<string, string>): number | undefined {
    const key = this.getMetricKey(name, labels);
    const metrics = this.metrics.get(key);
    
    if (!metrics || metrics.length === 0) {
      return undefined;
    }

    const last = metrics[metrics.length - 1]!;
    return typeof last.value === 'number' ? last.value : undefined;
  }

  /**
   * Get metrics for a time range
   */
  getMetrics(
    name: string,
    startTime: number,
    endTime: number,
    labels?: Record<string, string>
  ): Metric[] {
    const key = this.getMetricKey(name, labels);
    const metrics = this.metrics.get(key) || [];
    
    return metrics.filter(
      m => m.timestamp >= startTime && m.timestamp <= endTime
    );
  }

  /**
   * Get all metric names
   */
  getMetricNames(): string[] {
    const names = new Set<string>();
    for (const key of this.metrics.keys()) {
      const name = key.split('{')[0]!;
      names.add(name);
    }
    return [...names];
  }

  /**
   * Get collector statistics for monitoring
   */
  getStats(): MetricsCollectorStats {
    let totalMetrics = 0;
    for (const metrics of this.metrics.values()) {
      totalMetrics += metrics.length;
    }

    return {
      totalKeys: this.metrics.size,
      totalMetrics,
      aggregationsCount: this.aggregations.size,
      keysEvicted: this.keysEvicted,
      lastAlertTime: this.lastAlertTime,
    };
  }

  // ============================================================================
  // Database Persistence
  // ============================================================================

  /**
   * Persist metrics to database
   */
  async persistMetrics(): Promise<void> {
    if (!this.db) {
      return;
    }

    try {
      const batch: Metric[] = [];
      
      for (const metrics of this.metrics.values()) {
        // Get last un-persisted metric
        const lastMetric = metrics[metrics.length - 1];
        if (lastMetric) {
          batch.push(lastMetric);
        }
      }

      if (batch.length === 0) return;

      // P0-4 FIX: Batch inserts to prevent exceeding PostgreSQL's 65535 parameter limit.
      // Each metric uses 5 parameters, so 500 metrics = 2500 params per batch (well under limit).
      const BATCH_SIZE = 500;
      let totalPersisted = 0;

      for (let batchStart = 0; batchStart < batch.length; batchStart += BATCH_SIZE) {
        const chunk = batch.slice(batchStart, batchStart + BATCH_SIZE);

        const values = chunk.map((_, i) =>
          `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`
        ).join(',');

        const params = chunk.flatMap(m => [
          m.name,
          m.type,
          String(m.value),
          JSON.stringify(m.labels || {}),
          new Date(m.timestamp),
        ]);

        await this.db.query(
          `INSERT INTO metrics (name, type, value, labels, timestamp)
           VALUES ${values}`,
          params
        );

        totalPersisted += chunk.length;
      }

      logger.debug('Metrics persisted', { count: totalPersisted });
    } catch (error) {
      // P1-9 FIX: Safely handle unknown error type instead of unsafe cast
      logger.error('Failed to persist metrics', error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Generate metric key from name and labels
   */
  private getMetricKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
    this.aggregations.clear();
    this.keyAccessOrder.clear();
    this.keysEvicted = 0;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalCollector: MetricsCollector | null = null;

/**
 * Initialize global metrics collector
 */
export function initMetricsCollector(
  config?: Partial<AggregationConfig>,
  db?: Pool
): MetricsCollector {
  if (!globalCollector) {
    globalCollector = new MetricsCollector(config, db);
  }
  return globalCollector;
}

/**
 * Get global metrics collector
 */
export function getMetricsCollector(): MetricsCollector {
  if (!globalCollector) {
    throw new Error('Metrics collector not initialized. Call initMetricsCollector first.');
  }
  return globalCollector;
}

/**
 * FIX(P2): Reset the global collector for test isolation.
 * Without this, the module-level singleton persists across Jest test files
 * in the same worker, causing cross-test pollution (metrics from one test
 * appearing in the next). Call in afterAll/afterEach as needed.
 */
export function resetMetricsCollector(): void {
  if (globalCollector) {
    globalCollector.stop();
    globalCollector.clear();
  }
  globalCollector = null;
}

/**
 * Record a counter metric (convenience function)
 */
export function counter(
  name: string,
  value?: number,
  labels?: Record<string, string>
): void {
  getMetricsCollector().counter(name, value, labels);
}

/**
 * Record a gauge metric (convenience function)
 */
export function gauge(
  name: string,
  value: number,
  labels?: Record<string, string>
): void {
  getMetricsCollector().gauge(name, value, labels);
}

/**
 * Record a timing metric (convenience function)
 */
export function timing(
  name: string,
  durationMs: number,
  labels?: Record<string, string>
): void {
  getMetricsCollector().timing(name, durationMs, labels);
}
