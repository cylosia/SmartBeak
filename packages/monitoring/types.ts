/**
 * Monitoring Types
 * Type definitions for the monitoring package
 *
 * CRITICAL SECURITY NOTES:
 * - Never include PII (email, phone, SSN, IP addresses) in span attributes or metric dimensions
 * - Never use high-cardinality values (user IDs, request IDs, timestamps) as metric label keys
 * - Metric cardinality explosion can cause OTelemetry collector crashes and data loss
 *
 * CARDINALITY GUIDELINES:
 * - Span/metric attributes: low-cardinality only (status, HTTP method, error code, service name)
 * - Alert metadata: primitive values only, no nested objects
 */

/**
 * FIXED (MONITORING-CARDINALITY): Safe attribute value types for spans, metrics, and alerts.
 * Restricts to primitives that OpenTelemetry supports natively and cannot carry nested PII.
 * High-cardinality values (user IDs, request UUIDs, timestamps as strings) MUST NOT be used
 * as attribute keys or metric dimension values.
 */
export type SafeAttributeValue = string | number | boolean | string[] | number[] | boolean[];

// ============================================================================
// Legacy Types (for backward compatibility)
// ============================================================================

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  /** Application name */
  appName: string;
  /** Environment */
  environment: string;
  /** Metrics collection interval in milliseconds */
  collectionIntervalMs?: number;
  /** Alert thresholds */
  thresholds?: {
    cpu?: number;
    memory?: number;
    errorRate?: number;
    latency?: number;
  };
}

/**
 * Alert structure
 */
export interface Alert {
  /** Alert ID */
  id: string;
  /** Alert name/title */
  name: string;
  /** Alert severity */
  severity: 'info' | 'warning' | 'critical';
  /** Alert message */
  message: string;
  /** Alert timestamp */
  timestamp: Date;
  /**
   * Alert metadata — low-cardinality primitives only, no PII.
   * FIXED (MONITORING-ALERT-METADATA): Narrowed from Record<string, unknown> to prevent
   * accidental inclusion of PII or nested objects that could be forwarded to Slack/PagerDuty.
   * Approved keys: rule_id, component_name, severity_reason, threshold_value, affected_service.
   */
  metadata?: Record<string, SafeAttributeValue>;
  /** Whether alert is acknowledged */
  acknowledged?: boolean;
}

/**
 * Health status structure
 */
export interface HealthStatus {
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Health check timestamp */
  timestamp: Date;
  /** Component statuses */
  components: Record<string, {
    status: 'healthy' | 'degraded' | 'unhealthy';
    message?: string;
    latencyMs?: number;
  }>;
  /** System metrics */
  metrics?: {
    cpu?: number;
    memory?: number;
    requestsPerSecond?: number;
    errorRate?: number;
  };
}

// ============================================================================
// New Monitoring Types
// ============================================================================

/**
 * Metric dimension for multi-dimensional metrics
 */
export interface MetricDimension {
  name: string;
  value: string;
}

/**
 * Metric time series
 */
export interface MetricTimeSeries {
  metric: string;
  dimensions: MetricDimension[];
  datapoints: {
    timestamp: number;
    value: number;
  }[];
}

/**
 * Dashboard configuration
 */
export interface DashboardConfig {
  id: string;
  name: string;
  panels: DashboardPanel[];
  refreshInterval?: number;
  timeRange: {
    from: string;
    to: string;
  };
}

/**
 * Dashboard panel
 */
export interface DashboardPanel {
  id: string;
  title: string;
  type: 'line' | 'bar' | 'gauge' | 'stat' | 'table';
  metric: string;
  aggregation: 'avg' | 'sum' | 'min' | 'max' | 'count';
  dimensions?: string[];
  /**
   * Panel visualization options.
   * FIXED (MONITORING-PANEL-OPTIONS): Narrowed from Record<string, unknown> to SafeAttributeValue
   * to prevent injection of credentials, nested objects, or invalid configuration values.
   */
  options?: Record<string, SafeAttributeValue>;
}

/**
 * Trace span
 */
export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
  startTime: number;
  endTime: number;
  /**
   * Span attributes — low-cardinality, no PII.
   * FIXED (MONITORING-SPAN-ATTRS): Narrowed from Record<string, unknown> to SafeAttributeValue
   * to prevent cardinality explosion and PII leakage into OTelemetry backends.
   * NEVER store: user IDs, email addresses, request bodies, IP addresses, session tokens.
   * SAFE to store: HTTP method, HTTP status code, error code, operation name, service version.
   */
  attributes: Record<string, SafeAttributeValue>;
  status: { code: 'ok' | 'error'; message?: string };
  events: {
    timestamp: number;
    name: string;
    /** Span event attributes — same cardinality/PII constraints as span attributes */
    attributes?: Record<string, SafeAttributeValue>;
  }[];
}

/**
 * Complete trace
 */
export interface Trace {
  traceId: string;
  spans: TraceSpan[];
  duration: number;
  serviceName: string;
}

/**
 * Service dependency
 */
export interface ServiceDependency {
  source: string;
  target: string;
  callCount: number;
  errorCount: number;
  avgLatency: number;
}

/**
 * Service map
 */
export interface ServiceMap {
  services: string[];
  dependencies: ServiceDependency[];
}

/**
 * SLA/SLO configuration
 */
export interface SloConfig {
  id: string;
  name: string;
  metric: string;
  target: number; // e.g., 0.99 for 99%
  window: string; // e.g., '30d'
  alertThreshold: number; // e.g., 0.95
}

/**
 * SLA/SLO status
 */
export interface SloStatus {
  sloId: string;
  name: string;
  target: number;
  current: number;
  budgetRemaining: number; // Error budget remaining (0-1)
  status: 'healthy' | 'at_risk' | 'breached';
}

/**
 * Log entry for correlation
 */
export interface CorrelatedLogEntry {
  timestamp: string;
  level: string;
  message: string;
  service: string;
  traceId?: string;
  spanId?: string;
  /**
   * Log correlation attributes — low-cardinality only, no PII.
   * FIXED (MONITORING-LOG-ATTRS): Narrowed from Record<string, unknown> to SafeAttributeValue.
   */
  attributes: Record<string, SafeAttributeValue>;
}

/**
 * Incident management
 */
export interface Incident {
  id: string;
  title: string;
  description?: string;
  severity: 'sev1' | 'sev2' | 'sev3' | 'sev4' | 'sev5';
  status: 'open' | 'acknowledged' | 'mitigated' | 'resolved';
  alerts: string[];
  startedAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  assignedTo?: string;
}

// ============================================================================
// Golden Signals & Error Budget Types
// ============================================================================

/**
 * Saturation thresholds for golden signal monitoring
 */
export interface GoldenSignalThresholds {
  latency: { p99Warning: number; p99Critical: number };
  errorRate: { warning: number; critical: number };
  saturation: {
    memoryWarning: number; memoryCritical: number;
    cpuWarning: number; cpuCritical: number;
    queueDepthWarning: number; queueDepthCritical: number;
  };
}

/**
 * Error budget consumption level for SLO burn rate alerts
 */
export type ErrorBudgetAlertLevel = 'normal' | 'slow_burn' | 'fast_burn' | 'exhausted';
