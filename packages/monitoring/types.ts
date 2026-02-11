/**
 * Monitoring Types
 * Type definitions for the monitoring package
 */

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
  /** Alert metadata */
  metadata?: Record<string, unknown>;
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
  options?: Record<string, unknown>;
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
  attributes: Record<string, unknown>;
  status: { code: 'ok' | 'error'; message?: string };
  events: {
    timestamp: number;
    name: string;
    attributes?: Record<string, unknown>;
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
  attributes: Record<string, unknown>;
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
