import { getLogger } from '@kernel/logger';

const logger = getLogger('ops-metrics');

/**
 * Enhanced metrics with validation and error handling
 * - Metric validation
 * - Rate limiting to prevent log flooding
 * - Error handling
 * - Memory-efficient buffering
 */
const MAX_METRIC_NAME_LENGTH = 100;
const MAX_LABELS = 10;
const MAX_LABEL_LENGTH = 100;
const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_METRICS_PER_WINDOW = 1000;
// P2-8 FIX: Added max buffer size to prevent unbounded growth
const MAX_BUFFER_SIZE = 10000;
const metricBuffer: MetricBuffer = {
  metrics: [],
  lastFlush: Date.now(),
};
let metricsInWindow = 0;
let windowStart = Date.now();

// P2-12 FIX: Periodic flush interval with proper cleanup
const FLUSH_INTERVAL_MS = 5000;
let flushInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic metric flushing
 */
export function startMetricsFlushing(): void {
  if (flushInterval !== null) return;
  flushInterval = setInterval(() => {
    flushMetrics();
  }, FLUSH_INTERVAL_MS);
}

/**
 * P2-12 FIX: Stop periodic metric flushing and flush remaining metrics.
 * Must be called during graceful shutdown to prevent interval leak.
 */
export function stopMetricsFlushing(): void {
  if (flushInterval !== null) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  // Flush any remaining metrics in the buffer
  flushMetrics();
}
/**
 * Get current rate limit status
 * @returns Current metrics count and window start time
 */


export interface MetricBuffer {
  metrics: Metric[];
  lastFlush: number;
}

export type Metric = {
  name: string;
  value?: number;
  labels?: Record<string, string>;
  timestamp?: number;
};

export function getRateLimitStatus(): { count: number; windowStart: number } {
  return { count: metricsInWindow, windowStart };
}
/**
 * MEDIUM FIX M3: Validate metric name
 */
function validateMetricName(name: string): void {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Invalid metric name: must be a non-empty string');
  }
  if (name.length > MAX_METRIC_NAME_LENGTH) {
    throw new Error(`Invalid metric name: exceeds maximum length of ${MAX_METRIC_NAME_LENGTH}`);
  }
  // Allow only alphanumeric, underscores, and dots
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(name)) {
    throw new Error('Invalid metric name: must match pattern [a-zA-Z_][a-zA-Z0-9_.]*');
  }
}
/**
 * MEDIUM FIX M3: Validate metric labels
 */
function validateLabels(labels: Record<string, string> | undefined): void {
  if (labels === undefined)
    return;
  if (typeof labels !== 'object' || labels === null) {
    throw new Error('Invalid labels: must be an object');
  }
  const labelCount = Object.keys(labels).length;
  if (labelCount > MAX_LABELS) {
    throw new Error(`Invalid labels: too many labels (${labelCount} > ${MAX_LABELS})`);
  }
  // FIX(P2-MET-05): Validate label key format against Prometheus naming rules.
  // Previously any non-empty string was accepted, including keys with '.', '-',
  // spaces, or unicode — which Prometheus rejects at scrape time. Attacker-controlled
  // label keys (e.g. from request headers reflected into metrics) could also inject
  // labels or cause metric cardinality explosion.
  const LABEL_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  for (const [key, value] of Object.entries(labels)) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('Invalid label key: must be a non-empty string');
    }
    if (!LABEL_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid label key '${key}': must match Prometheus pattern [a-zA-Z_][a-zA-Z0-9_]*`);
    }
    if (key.length > MAX_LABEL_LENGTH) {
      throw new Error(`Invalid label key: exceeds maximum length of ${MAX_LABEL_LENGTH}`);
    }
    if (typeof value !== 'string') {
      throw new Error(`Invalid label value for key '${key}': must be a string`);
    }
    if (value.length > MAX_LABEL_LENGTH) {
      throw new Error(`Invalid label value for key '${key}': exceeds maximum length of ${MAX_LABEL_LENGTH}`);
    }
  }
}
/**
 * MEDIUM FIX M4: Check rate limit
 */
function checkRateLimit(): boolean {
  const now = Date.now();
  // Reset window if needed
  if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
    windowStart = now;
    metricsInWindow = 0;
  }
  if (metricsInWindow >= MAX_METRICS_PER_WINDOW) {
    return false;
  }
  metricsInWindow++;
  return true;
}
/**
 * Emit a metric with validation and rate limiting
 * @param metric - Metric to emit
 */
export function emitMetric(metric: Metric): void {
  try {
        validateMetricName(metric.name);
    validateLabels(metric.labels);
        if (!checkRateLimit()) {
      // P1-10 FIX: Use structured logger
      logger.warn('[emitMetric] Rate limit exceeded, dropping metric', { metricName: metric.name });
      return;
    }
    // FIX(P2-MET-04): Apply the value default at enrichment time, not at log
    // time. Previously the buffer stored value=undefined while the log printed
    // value=1, creating a discrepancy: the metric backend would receive undefined
    // but operators reading logs would see 1 — a silent observability lie.
    const enrichedMetric = {
      ...metric,
      value: metric.value ?? 1,
      timestamp: metric.timestamp ?? Date.now(),
    };

    // P2-8 FIX: Enforce max buffer size to prevent unbounded memory growth
    if (metricBuffer.metrics.length >= MAX_BUFFER_SIZE) {
      // Drop oldest metrics when buffer is full
      metricBuffer.metrics = metricBuffer.metrics.slice(-Math.floor(MAX_BUFFER_SIZE / 2));
      logger.warn('[emitMetric] Buffer overflow, dropped oldest metrics');
    }

    metricBuffer.metrics.push(enrichedMetric);
        const now = Date.now();
    if (metricBuffer.metrics.length >= 100 || now - metricBuffer.lastFlush > 5000) {
      flushMetrics();
    }
    // P1-10 FIX: Use structured logger for metric emission
    logger.debug('[METRIC]', { name: enrichedMetric.name, labels: enrichedMetric.labels, value: enrichedMetric.value });
  }
  catch (error) {
    // P1-10 FIX: Use structured logger
    logger.error('[emitMetric] Error emitting metric:', error instanceof Error ? error : new Error(String(error)));
  }
}
/**
 * FIX(P2): Reset all module-level state for test isolation.
 * Without this, module-level singletons (metricBuffer, metricsInWindow,
 * windowStart, flushInterval) persist between Jest test files in the same
 * worker, causing cross-test pollution.
 */
export function resetMetricsState(): void {
  metricBuffer.metrics = [];
  metricBuffer.lastFlush = Date.now();
  metricsInWindow = 0;
  windowStart = Date.now();
  if (flushInterval !== null) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
}

/**
 * MEDIUM FIX M4: Flush buffered metrics
 */
function flushMetrics(): void {
  if (metricBuffer.metrics.length === 0)
    return;
  try {
    // In production, this would send to metrics backend
    logger.debug(`[METRICS_FLUSH] Flushing ${metricBuffer.metrics.length} metrics`);
    // Clear buffer
    metricBuffer.metrics = [];
    metricBuffer.lastFlush = Date.now();
  }
  catch (error) {
    // P1-10 FIX: Use structured logger
    logger.error('[flushMetrics] Error flushing metrics:', error instanceof Error ? error : new Error(String(error)));
  }
}
