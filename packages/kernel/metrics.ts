import { getLogger, getRequestContext } from '@kernel/logger';

/**
* Metrics utilities for kernel package
*
* Provides metric emission, handlers, and helper functions
* for monitoring application performance and health.

*/

// ============================================================================
// Type Definitions
// ============================================================================

/**
* Metric data structure
*/
export interface Metric {
  /** Metric name */
  name: string;
  // P1-FIX: Narrowed from `Record<string, string | number>` to
  // `Record<string, string>` to match the Prometheus/OpenTelemetry label
  // convention (all label values are strings).  The previous union type
  // allowed callers to pass numeric values which were implicitly coerced,
  // producing inconsistent key formats across exporters.
  /** Optional labels/tags — all values must be strings */
  labels?: Record<string, string>;
  /** Metric value */
  value?: number;
  /** Timestamp in milliseconds */
  timestamp?: number;
}

/**
* Handler function for metrics
*/
export type MetricHandler = (metric: Metric) => void;

// ============================================================================
// Internal State
// ============================================================================

// P2-35 FIX: Maximum number of handlers to prevent unbounded handler growth
const MAX_HANDLERS = 10;

const handlersStore = {
  handlers: [] as MetricHandler[]
};

// Read-only access to handlers
const getHandlers = (): readonly MetricHandler[] => handlersStore.handlers;

// Internal mutable access
const getMutableHandlers = (): MetricHandler[] => handlersStore.handlers;

// ============================================================================
// Default Handler
// ============================================================================

/**
* Default metric handler that logs using structured logger
* @param metric - Metric to log
*/
function structuredLoggerHandler(metric: Metric): void {
  const ctx = getRequestContext();
  const logger = getLogger({
  service: 'metrics',
  correlationId: ctx?.requestId,
  });

  logger.info('Metric emitted', {
  metricName: metric.name,
  labels: metric.labels,
  value: metric.value,
  timestamp: metric.timestamp,
  });
}

// ============================================================================
// Handler Management
// ============================================================================

/**
* Add a metric handler
* P2-35 FIX: Enforces a maximum handler limit to prevent unbounded growth
* @param handler - Handler function to add
* @throws Error if maximum handler limit is reached
*/
/**
 * Add a metric handler.
 * P1-FIX: Returns `true` when the handler was registered, `false` when the
 * MAX_HANDLERS cap was hit and the handler was silently dropped.  The previous
 * `void` return type left callers with no way to detect the drop, leading to
 * silent data loss (metrics emitted after the limit would never reach the
 * dropped handler).
 */
export function addMetricHandler(handler: MetricHandler): boolean {
  if (getHandlers().length >= MAX_HANDLERS) {
    const logger = getLogger({ service: 'metrics' });
    // P1-FIX: Use dot notation — `error` is an explicitly declared method on
    // the logger type, not accessed via an index signature.
    logger.error('Cannot add metric handler: maximum limit reached', new Error(`Max handlers (${MAX_HANDLERS}) exceeded`));
    return false;
  }
  getMutableHandlers().push(handler);
  return true;
}

/**
* Remove all metric handlers
* P2-36 FIX: Replace the array entirely instead of setting length = 0
* to avoid dangling references from code holding the old array
*/
export function clearMetricHandlers(): void {
  handlersStore.handlers = [];
}

// Add default handler using structured logger (only if none exist)
if (getHandlers().length === 0) {
  addMetricHandler(structuredLoggerHandler);
}

// ============================================================================
// Metric Emission
// ============================================================================

/**
* Emit a metric
* @param metric - Metric to emit
*/
export function emitMetric(metric: Metric): void {
  const metricWithTimestamp = {
  ...metric,
  timestamp: metric.timestamp ?? Date.now(),
  };

  // P2-FIX: Error isolation - one handler failure should not affect others
  // P3-3 FIX: Catch async handler rejections to prevent unhandled promise rejections
  getHandlers().forEach(h => {
    try {
      const result = h(metricWithTimestamp);
      // If handler returns a Promise, catch its rejection
      if (result != null && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error: unknown) => {
          // P1-FIX: Use dot notation — error is a declared method, not index access
          const logger = getLogger({ service: 'metrics' });
          logger.error('Async metric handler failed', error instanceof Error ? error : new Error(String(error)));
        });
      }
    } catch (error) {
      const logger = getLogger({ service: 'metrics' });
      logger.error('Metric handler failed', error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
* Create a timer metric
* @param name - Base metric name
* @param durationMs - Duration in milliseconds
* @param labels - Optional labels
*/
export function emitTimer(name: string, durationMs: number, labels?: Record<string, string>): void {
  emitMetric({
  name: `${name}_duration_ms`,
  value: durationMs,
  ...(labels != null ? { labels } : {}),
  });
}

/**
* Create a counter metric
* @param name - Base metric name
* @param increment - Amount to increment (default: 1)
* @param labels - Optional labels
*/
export function emitCounter(name: string, increment = 1, labels?: Record<string, string>): void {
  emitMetric({
  name: `${name}_total`,
  value: increment,
  ...(labels != null ? { labels } : {}),
  });
}

/**
* Create a gauge metric
* @param name - Base metric name
* @param value - Gauge value
* @param labels - Optional labels
*/
export function emitGauge(name: string, value: number, labels?: Record<string, string>): void {
  emitMetric({
  name: `${name}_gauge`,
  value,
  ...(labels != null ? { labels } : {}),
  });
}
