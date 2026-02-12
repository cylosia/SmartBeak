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
  /** Optional labels/tags */
  labels?: Record<string, string | number>;
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
* @param handler - Handler function to add
*/
export function addMetricHandler(handler: MetricHandler): void {
  getMutableHandlers().push(handler);
}

/**
* Remove all metric handlers
*/
export function clearMetricHandlers(): void {
  getMutableHandlers().length = 0;
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
  getHandlers().forEach(h => {
    try {
      h(metricWithTimestamp);
    } catch (error) {
      const logger = getLogger({ service: 'metrics' });
      logger["error"]('Metric handler failed', error instanceof Error ? error : new Error(String(error)));
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
  labels, // P0-5 FIX: Pass labels through (was silently dropped)
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
  labels, // P0-5 FIX: Pass labels through (was silently dropped)
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
  value, // P0-4 FIX: Pass value through (was silently dropped)
  labels, // P0-5 FIX: Pass labels through (was silently dropped)
  });
}
