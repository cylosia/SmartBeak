/**
 * Monitoring Package
 * Comprehensive monitoring and observability for SmartBeak
 * 
 * Provides:
 * - Distributed tracing with OpenTelemetry
 * - Metrics collection (business, system, custom)
 * - Deep health checks with readiness/liveness probes
 * - Comprehensive alerting rules
 */

// ============================================================================
// Initialization
// ============================================================================
export {
  initMonitoring,
  shutdownMonitoring,
  createHealthMiddleware,
  createMetricsMiddleware,
  type MonitoringInitConfig,
  type MonitoringComponents,
} from './init';

// ============================================================================
// Telemetry (Distributed Tracing)
// ============================================================================
export {
  // Initialization
  initTelemetry,
  shutdownTelemetry,
  getTracerProvider,
  isTelemetryInitialized,
  
  // Context Propagation
  extractTraceContext,
  injectTraceContext,
  getCurrentTraceId,
  getCurrentSpanId,
  
  // Span Operations
  startSpan,
  withSpan,
  addSpanAnnotation,
  addSpanAttributes,
  recordSpanException,
  setSpanStatus,
  Trace,
  
  // Types
  type TelemetryConfig,
  type SpanAnnotation,
  type TracedOperationOptions,
} from './telemetry';

// ============================================================================
// Metrics Collection
// ============================================================================
export {
  // Classes
  MetricsCollector,
  
  // Initialization
  initMetricsCollector,
  getMetricsCollector,
  
  // Convenience Functions
  counter,
  gauge,
  timing,
  
  // Types
  type Metric,
  type MetricType,
  type BusinessMetrics,
  type SystemMetrics,
  type AggregationConfig,
  type AggregatedMetric,
} from './metrics-collector';

// ============================================================================
// Health Checks
// ============================================================================
export {
  // Classes
  HealthChecksRegistry,
  
  // Initialization
  initHealthChecks,
  getHealthChecks,
  
  // Health Check Factories
  createDatabaseHealthCheck,
  createRedisHealthCheck,
  createExternalApiHealthCheck,
  createDiskHealthCheck,
  createMemoryHealthCheck,
  
  // Types
  type HealthStatus,
  type HealthCheckResult,
  type HealthReport,
  type ReadinessResult,
  type LivenessResult,
  type HealthCheckFn,
  type HealthCheckConfig,
  type DatabaseHealthOptions,
  type RedisHealthOptions,
  type ExternalApiHealthOptions,
} from './health-checks';

// ============================================================================
// Alerting Rules
// ============================================================================
export {
  // Classes
  AlertRulesEngine,
  
  // Initialization
  initAlertRules,
  getAlertRules,
  
  // Default Rules
  defaultAlertRules,
  
  // Notification Handlers
  createSlackHandler,
  createWebhookHandler,
  createEmailHandler,
  
  // Types
  type AlertSeverity,
  type AlertStatus,
  type AlertChannel,
  type AlertOperator,
  type AlertAggregation,
  type AlertRule,
  type AlertCategory,
  type AlertInstance,
  type NotificationPayload,
  type NotificationHandler,
  type AlertingConfig,
} from './alerting-rules';

// ============================================================================
// Cost Tracking
// ============================================================================
export {
  CostTracker,
  type CostEntry,
  type BudgetAlert,
  type CostBreakdown,
} from './costTracker';

// ============================================================================
// Legacy Exports (for backward compatibility)
// ============================================================================
export { JobOptimizer } from './jobOptimizer';
export { AlertingSystem } from './alerting';
export type { MonitoringConfig, Alert } from './types';
