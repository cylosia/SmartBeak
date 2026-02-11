/**
 * Analytics Types
 * Type definitions for the analytics package
 */

/**
 * Analytics configuration
 */
export interface AnalyticsConfig {
  /** Application name for analytics */
  appName: string;
  /** Environment (production, staging, development) */
  environment: string;
  /** Sampling rate (0-1) */
  sampleRate?: number;
  /** Batch size for event collection */
  batchSize?: number;
  /** Flush interval in milliseconds */
  flushIntervalMs?: number;
}

/**
 * Analytics event structure
 */
export interface AnalyticsEvent {
  /** Event name */
  name: string;
  /** Event timestamp */
  timestamp: Date;
  /** Event properties */
  properties?: Record<string, unknown>;
  /** User ID (optional) */
  userId?: string;
  /** Session ID (optional) */
  sessionId?: string;
}

/**
 * Analytics report structure
 */
export interface AnalyticsReport {
  /** Report ID */
  id: string;
  /** Report name */
  name: string;
  /** Report period start */
  startDate: Date;
  /** Report period end */
  endDate: Date;
  /** Report metrics */
  metrics: Record<string, number>;
  /** Report data */
  data: unknown[];
}
