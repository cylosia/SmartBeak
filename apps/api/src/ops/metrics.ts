import { getLogger, getRequestContext } from '@kernel/logger';

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
const metricBuffer: MetricBuffer = {
  metrics: [],
  lastFlush: Date.now(),
};
let metricsInWindow = 0;
let windowStart = Date.now();
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

export function getRateLimitStatus() {
  return { count: metricsInWindow, windowStart };
}
/**
 * MEDIUM FIX M3: Validate metric name
 */
function validateMetricName(name: string) {
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
function validateLabels(labels: Record<string, string> | undefined) {
  if (labels === undefined)
    return;
  if (typeof labels !== 'object' || labels === null) {
    throw new Error('Invalid labels: must be an object');
  }
  const labelCount = Object.keys(labels).length;
  if (labelCount > MAX_LABELS) {
    throw new Error(`Invalid labels: too many labels (${labelCount} > ${MAX_LABELS})`);
  }
  for (const [key, value] of Object.entries(labels)) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('Invalid label key: must be a non-empty string');
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
function checkRateLimit() {
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
export function emitMetric(metric: Metric) {
  try {
        validateMetricName(metric.name);
    validateLabels(metric.labels);
        if (!checkRateLimit()) {
      console.warn('[emitMetric] Rate limit exceeded, dropping metric:', metric.name);
      return;
    }
        const enrichedMetric = {
      ...metric,
      timestamp: metric.timestamp || Date.now(),
    };
        metricBuffer.metrics.push(enrichedMetric);
        const now = Date.now();
    if (metricBuffer.metrics.length >= 100 || now - metricBuffer.lastFlush > 5000) {
      flushMetrics();
    }
    // Hook for Prometheus / Datadog / CloudWatch
    console.log('[METRIC]', enrichedMetric.name, enrichedMetric.labels ?? {}, enrichedMetric.value ?? 1);
  }
  catch (error) {
        console.error('[emitMetric] Error emitting metric:', error);
  }
}
/**
 * MEDIUM FIX M4: Flush buffered metrics
 */
function flushMetrics() {
  if (metricBuffer.metrics.length === 0)
    return;
  try {
    // In production, this would send to metrics backend
    console.log(`[METRICS_FLUSH] Flushing ${metricBuffer.metrics.length} metrics`);
    // Clear buffer
    metricBuffer.metrics = [];
    metricBuffer.lastFlush = Date.now();
  }
  catch (error) {
    console.error('[flushMetrics] Error flushing metrics:', error);
  }
}
