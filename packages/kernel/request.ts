import { randomUUID } from 'crypto';
import { getLogger } from './logger';

/**
* Request utilities
*
* Provides request ID generation, context tracking,
* structured logging, and metrics collection.
*
* This module was extracted from apps/api/src/utils/request.ts
* to prevent cross-boundary imports.
*/

// ============================================================================
// Logger
// ============================================================================

const logger = getLogger('RequestHandler');

// ============================================================================
// Request ID
// ============================================================================

/**
* Generate a unique request ID
* @returns UUID string
*/
export function generateRequestId(): string {
  return randomUUID();
}

// ============================================================================
// Request Context
// ============================================================================

/**
* Request context for tracking
*/
export interface RequestContext {
  /** Unique request ID */
  requestId: string;
  /** Optional correlation ID for tracing */
  correlationId?: string;
  /** Name of the adapter */
  adapterName: string;
  /** Operation being performed */
  operation: string;
  /** Timestamp when request started */
  startTime: number;
}

/**
* Create a request context
* @param adapterName - Name of the adapter
* @param operation - Operation being performed
* @param correlationId - Optional correlation ID
* @returns Request context object
*/
export function createRequestContext(
  adapterName: string,
  operation: string,
  _correlationId?: string
): RequestContext {
  return {
    requestId: generateRequestId(),
    adapterName,
    operation,
    startTime: Date.now(),
  };
}

// ============================================================================
// Structured Logging
// ============================================================================

/**
* Log entry structure
*/
export interface LogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Log level */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Log message */
  message: string;
  /** Request ID */
  requestId: string;
  /** Correlation ID */
  correlationId?: string | undefined;
  /** Adapter name */
  adapter: string;
  /** Operation name */
  operation: string;
  /** Duration in milliseconds */
  durationMs?: number | undefined;
  /** Additional metadata */
  metadata?: Record<string, unknown> | undefined;
  /** Error details */
  error?: {
  message: string;
  stack?: string;
  code?: string;
  } | undefined;
}

/**
* Structured logger for consistent logging across adapters
*/
export class StructuredLogger {
  /**
  * Creates an instance of StructuredLogger
  * @param adapterName - Name of the adapter using this logger
  */
  constructor(private readonly adapterName: string) {}

  private log(
  level: LogEntry['level'],
  message: string,
  context: RequestContext,
  metadata?: Record<string, unknown>,
  error?: Error
  ): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    requestId: context.requestId,
    correlationId: context["correlationId"],
    adapter: this.adapterName,
    operation: context.operation,
    durationMs: Date.now() - context.startTime,
    // Previously `metadata` was accepted as a parameter but never written to
    // the entry, silently dropping all structured log context from callers.
    metadata,
  };

  if (error) {
    entry.error = {
      message: error.message,
    };
    // Stack traces reveal internal file paths and line numbers. Only include
    // them in development; omit in production to reduce information leakage.
    if (error.stack !== undefined && process.env['NODE_ENV'] === 'development') {
      entry.error.stack = error.stack;
    }
    const errorWithCode = error as { code?: string };
    if (errorWithCode.code !== undefined && entry.error) {
      entry.error.code = errorWithCode.code;
    }
  }

  // Pass the structured entry object directly to the logger rather than
  // double-serialising it (JSON.stringify → string → new Error(string)).
  // The previous approach caused the error message itself to be a JSON blob,
  // making log aggregation and search significantly harder.
  if (level === 'error') {
    logger.error(message, error ?? new Error(message), entry as Record<string, unknown>);
  } else if (level === 'warn') {
    logger.warn(message, entry as Record<string, unknown>);
  } else if (level === 'debug') {
    logger.debug(message, entry as Record<string, unknown>);
  } else {
    logger.info(message, entry as Record<string, unknown>);
  }
  }

  /**
  * Log at debug level
  * @param message - Log message
  * @param context - Request context
  * @param metadata - Additional metadata
  */
  debug(message: string, context: RequestContext, metadata?: Record<string, unknown>): void {
  this.log('debug', message, context, metadata);
  }

  /**
  * Log at info level
  * @param message - Log message
  * @param context - Request context
  * @param metadata - Additional metadata
  */
  info(message: string, context: RequestContext, metadata?: Record<string, unknown>): void {
  this.log('info', message, context, metadata);
  }

  /**
  * Log at warn level
  * @param message - Log message
  * @param context - Request context
  * @param metadata - Additional metadata
  * @param error - Optional error
  */
  warn(message: string, context: RequestContext, metadata?: Record<string, unknown>, error?: Error): void {
  this.log('warn', message, context, metadata, error);
  }

  /**
  * Log at error level
  * @param message - Log message
  * @param context - Request context
  * @param error - Error object
  * @param metadata - Additional metadata
  */
  error(message: string, context: RequestContext, error: Error, metadata?: Record<string, unknown>): void {
  this.log('error', message, context, metadata, error);
  }
}

// ============================================================================
// Metrics Collection
// ============================================================================

/**
* Metric data structure
*/
export interface Metric {
  /** Metric name */
  name: string;
  /** Metric value */
  value: number;
  /** Timestamp */
  timestamp: number;
  /** Metric tags */
  tags: Record<string, string>;
}

/**
* Metrics collector for tracking adapter performance
*/
export class MetricsCollector {
  private metrics: Metric[] = [];
  private readonly MAX_METRICS = 10000;

  /**
  * Creates an instance of MetricsCollector
  * @param adapterName - Name of the adapter using this collector
  */
  constructor(private readonly adapterName: string) {}

  /**
  * Record a metric
  * @param name - Metric name
  * @param value - Metric value
  * @param tags - Optional tags
  */
  record(name: string, value: number, tags: Record<string, string> = {}): void {
  if (this.metrics.length >= this.MAX_METRICS) {
    this.metrics.shift(); // Remove oldest
  }
  this.metrics.push({
    name: `${this.adapterName}.${name}`,
    value,
    timestamp: Date.now(),
    tags: { ...tags, adapter: this.adapterName },
  });
  }

  /**
  * Record latency metric
  * @param operation - Operation name
  * @param latencyMs - Latency in milliseconds
  * @param success - Whether operation succeeded
  */
  recordLatency(operation: string, latencyMs: number, success: boolean): void {
  this.record('latency', latencyMs, { operation, success: success ? 'true' : 'false' });
  }

  /**
  * Record error metric
  * @param operation - Operation name
  * @param errorType - Type of error
  */
  recordError(operation: string, errorType: string): void {
  this.record('error', 1, { operation, error_type: errorType });
  }

  /**
  * Record success metric
  * @param operation - Operation name
  */
  recordSuccess(operation: string): void {
  this.record('success', 1, { operation });
  }

  /**
  * Get all recorded metrics
  * @returns Array of metrics
  */
  getMetrics(): Metric[] {
  return [...this.metrics];
  }

  /**
  * Clear all recorded metrics
  */
  clear(): void {
  this.metrics = [];
  }

  /**
  * Get metrics count
  * @returns Number of metrics currently stored
  */
  getMetricsCount(): number {
  return this.metrics.length;
  }
}

// ============================================================================
// HTTP Headers
// ============================================================================

/**
* HTTP headers with request ID
* @param context - Request context
* @param additionalHeaders - Additional headers to include
* @returns Headers object with request tracking
*/
export function createRequestHeaders(
  context: RequestContext,
  additionalHeaders: Record<string, string> = {}
): Record<string, string> {
  return {
  'X-Request-ID': context.requestId,
  ...(context["correlationId"] && { 'X-Correlation-ID': context["correlationId"] }),
  ...additionalHeaders,
  };
}
