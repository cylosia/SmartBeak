/**
 * Monitoring Initialization Module
 * 
 * Provides one-stop setup for all monitoring components:
 * - Distributed tracing
 * - Metrics collection
 * - Health checks
 * - Alerting rules
 */

import { Pool } from 'pg';
import { getLogger } from '@kernel/logger';

import {
  initTelemetry,
  TelemetryConfig,
  shutdownTelemetry,
} from './telemetry';

import {
  initMetricsCollector,
  MetricsCollector,
  AggregationConfig,
} from './metrics-collector';

import {
  initHealthChecks,
  HealthChecksRegistry,
  createDatabaseHealthCheck,
  createRedisHealthCheck,
  createExternalApiHealthCheck,
  createMemoryHealthCheck,
  DatabaseHealthOptions,
  RedisHealthOptions,
  ExternalApiHealthOptions,
} from './health-checks';

import {
  initAlertRules,
  AlertRulesEngine,
  AlertingConfig,
  createSlackHandler,
  createWebhookHandler,
  createEmailHandler,
} from './alerting-rules';

import {
  ResourceMetricsCollector,
  initResourceMetrics,
  ResourceMetricsConfig,
} from './resource-metrics';

import {
  SloTracker,
  initSloTracker,
  defaultSloDefinitions,
} from './slo-tracker';

import {
  BusinessKpiTracker,
  initBusinessKpis,
} from './business-kpis';

const logger = getLogger('monitoring-init');

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Complete monitoring configuration
 */
export interface MonitoringInitConfig {
  /** Service identification */
  service: {
    name: string;
    version: string;
    environment: string;
  };
  
  /** Telemetry configuration */
  telemetry?: Partial<TelemetryConfig> & {
    enabled?: boolean;
  };
  
  /** Metrics configuration */
  metrics?: Partial<AggregationConfig> & {
    enabled?: boolean;
  };
  
  /** Health checks configuration */
  health?: {
    enabled?: boolean;
    checks?: {
      database?: DatabaseHealthOptions;
      redis?: RedisHealthOptions;
      externalApis?: ExternalApiHealthOptions[];
    };
  };
  
  /** Alerting configuration */
  alerting?: AlertingConfig & {
    enabled?: boolean;
    slackWebhookUrl?: string;
    webhookUrl?: string;
    emailAddresses?: string[];
  };

  /** Resource metrics configuration */
  resourceMetrics?: ResourceMetricsConfig & {
    enabled?: boolean;
  };

  /** SLO tracker configuration */
  sloTracker?: {
    enabled?: boolean;
  };

  /** Business KPIs configuration */
  businessKpis?: {
    enabled?: boolean;
  };

  /** Database connection for persistence */
  db?: Pool;
}

/**
 * Initialized monitoring components
 */
export interface MonitoringComponents {
  telemetry: {
    initialized: boolean;
    shutdown: () => Promise<void>;
  };
  metrics: {
    collector: MetricsCollector;
    start: () => void;
    stop: () => void;
  };
  health: {
    registry: HealthChecksRegistry;
    cleanup: () => void;
  };
  alerting: {
    engine: AlertRulesEngine;
    start: (intervalMs?: number) => void;
    stop: () => void;
  };
  resourceMetrics: {
    collector: ResourceMetricsCollector;
    start: () => void;
    stop: () => void;
  };
  sloTracker: {
    tracker: SloTracker;
    start: () => void;
    stop: () => void;
  };
  businessKpis: {
    tracker: BusinessKpiTracker;
    start: () => void;
    stop: () => void;
  };
}

// ============================================================================
// Initialization Function
// ============================================================================

/**
 * Initialize all monitoring components
 * @param config - Monitoring configuration
 * @returns Initialized components
 */
export function initMonitoring(config: MonitoringInitConfig): MonitoringComponents {
  logger.info('Initializing monitoring components...', {
    service: config.service.name,
    environment: config.service.environment,
  });

  // Initialize Telemetry (Distributed Tracing)
  let telemetryInitialized = false;
  if (config.telemetry?.enabled !== false) {
    try {
      initTelemetry({
        serviceName: config.service.name,
        serviceVersion: config.service.version,
        environment: config.service.environment,
        ...(config.telemetry?.collectorEndpoint && { collectorEndpoint: config.telemetry.collectorEndpoint }),
        ...(config.telemetry?.enableConsoleExporter && { enableConsoleExporter: config.telemetry.enableConsoleExporter }),
        samplingRate: config.telemetry?.samplingRate ?? 1.0,
        autoInstrumentations: config.telemetry?.autoInstrumentations ?? true,
        ...(config.telemetry?.resourceAttributes && { resourceAttributes: config.telemetry.resourceAttributes }),
      });
      telemetryInitialized = true;
      logger.info('✓ Telemetry initialized');
    } catch (error) {
      logger.error('Failed to initialize telemetry', error as Error);
    }
  }

  // Initialize Metrics Collector
  let metricsCollector: MetricsCollector;
  try {
    metricsCollector = initMetricsCollector(
      {
        intervalMs: config.metrics?.intervalMs ?? 60000,
        retentionMs: config.metrics?.retentionMs ?? 3600000,
        percentiles: config.metrics?.percentiles ?? [50, 90, 95, 99],
      },
      config.db
    );
    
    if (config.metrics?.enabled !== false) {
      metricsCollector.start();
      logger.info('✓ Metrics collector started');
    }
  } catch (error) {
    logger.error('Failed to initialize metrics collector', error as Error);
    throw error;
  }

  // Initialize Health Checks
  let healthRegistry: HealthChecksRegistry;
  try {
    healthRegistry = initHealthChecks(
      config.service.version,
      config.service.environment
    );

    // Register default health checks
    if (config.health?.enabled !== false) {
      // Database health check
      if (config.health?.checks?.database) {
        healthRegistry.register({
          name: 'database',
          check: createDatabaseHealthCheck(config.health.checks.database),
          intervalMs: 30000,
          severity: 'critical',
          enabled: true,
        });
      }

      // Redis health check
      if (config.health?.checks?.redis) {
        healthRegistry.register({
          name: 'redis',
          check: createRedisHealthCheck(config.health.checks.redis),
          intervalMs: 30000,
          severity: 'critical',
          enabled: true,
        });
      }

      // External API health checks
      if (config.health?.checks?.externalApis) {
        for (const api of config.health.checks.externalApis) {
          healthRegistry.register({
            name: api.name,
            check: createExternalApiHealthCheck(api),
            intervalMs: 60000,
            severity: 'warning',
            enabled: true,
          });
        }
      }

      // Memory health check (always enabled)
      healthRegistry.register({
        name: 'memory',
        check: createMemoryHealthCheck('memory', 80, 90),
        intervalMs: 30000,
        severity: 'warning',
        enabled: true,
      });

      logger.info('✓ Health checks registered', {
        count: healthRegistry.getCheckNames().length,
      });
    }
  } catch (error) {
    logger.error('Failed to initialize health checks', error as Error);
    throw error;
  }

  // Initialize Alerting Rules
  let alertingEngine: AlertRulesEngine;
  try {
    alertingEngine = initAlertRules({
      db: config.db,
      metricsCollector,
    } as AlertingConfig);

    if (config.alerting?.enabled !== false) {
      // Register notification handlers
      if (config.alerting?.slackWebhookUrl) {
        alertingEngine.registerNotificationHandler(
          'slack',
          createSlackHandler(config.alerting.slackWebhookUrl)
        );
      }

      if (config.alerting?.webhookUrl) {
        alertingEngine.registerNotificationHandler(
          'webhook',
          createWebhookHandler(config.alerting.webhookUrl)
        );
      }

      if (config.alerting?.emailAddresses && config.alerting.emailAddresses.length > 0) {
        alertingEngine.registerNotificationHandler(
          'email',
          createEmailHandler(config.alerting.emailAddresses)
        );
      }

      alertingEngine.start();
      logger.info('✓ Alerting rules engine started');
    }
  } catch (error) {
    logger.error('Failed to initialize alerting', error as Error);
    throw error;
  }

  // Initialize Resource Metrics
  let resourceMetricsCollector: ResourceMetricsCollector;
  try {
    resourceMetricsCollector = initResourceMetrics({
      pollingIntervalMs: config.resourceMetrics?.pollingIntervalMs,
    });

    if (config.resourceMetrics?.enabled !== false) {
      resourceMetricsCollector.start();
      logger.info('✓ Resource metrics collector started');
    }
  } catch (error) {
    logger.error('Failed to initialize resource metrics', error as Error);
    throw error;
  }

  // Initialize SLO Tracker
  let sloTracker: SloTracker;
  try {
    sloTracker = initSloTracker({
      metricsCollector: metricsCollector,
    });

    if (config.sloTracker?.enabled !== false) {
      // Register default SLO definitions
      for (const slo of defaultSloDefinitions) {
        sloTracker.registerSlo(slo);
      }
      sloTracker.start();
      logger.info('✓ SLO tracker started', { sloCount: defaultSloDefinitions.length });
    }
  } catch (error) {
    logger.error('Failed to initialize SLO tracker', error as Error);
    throw error;
  }

  // Initialize Business KPIs
  let businessKpiTracker: BusinessKpiTracker;
  try {
    businessKpiTracker = initBusinessKpis(metricsCollector);

    if (config.businessKpis?.enabled !== false) {
      businessKpiTracker.start();
      logger.info('✓ Business KPI tracker started');
    }
  } catch (error) {
    logger.error('Failed to initialize business KPIs', error as Error);
    throw error;
  }

  logger.info('✓ All monitoring components initialized');

  return {
    telemetry: {
      initialized: telemetryInitialized,
      shutdown: shutdownTelemetry,
    },
    metrics: {
      collector: metricsCollector,
      start: () => metricsCollector.start(),
      stop: () => metricsCollector.stop(),
    },
    health: {
      registry: healthRegistry,
      cleanup: () => healthRegistry.cleanup(),
    },
    alerting: {
      engine: alertingEngine,
      start: (intervalMs?: number) => alertingEngine.start(intervalMs),
      stop: () => alertingEngine.stop(),
    },
    resourceMetrics: {
      collector: resourceMetricsCollector,
      start: () => resourceMetricsCollector.start(),
      stop: () => resourceMetricsCollector.stop(),
    },
    sloTracker: {
      tracker: sloTracker,
      start: () => sloTracker.start(),
      stop: () => sloTracker.stop(),
    },
    businessKpis: {
      tracker: businessKpiTracker,
      start: () => businessKpiTracker.start(),
      stop: () => businessKpiTracker.stop(),
    },
  };
}

// ============================================================================
// Middleware Factories
// ============================================================================

/**
 * Create Express/Fastify middleware for health endpoints
 */
export function createHealthMiddleware(
  healthRegistry: HealthChecksRegistry,
  options: {
    healthPath?: string;
    readyPath?: string;
    livePath?: string;
  } = {}
) {
  const {
    healthPath = '/health',
    readyPath = '/ready',
    livePath = '/live',
  } = options;

  return async (req: { url: string }, res: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (data: string) => void;
  }, next?: () => void): Promise<void> => {
    const url = req.url;

    // Health endpoint
    if (url === healthPath) {
      const report = await healthRegistry.runAllChecks();
      res.statusCode = report.status === 'healthy' ? 200 : 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(report));
      return;
    }

    // Readiness endpoint
    if (url === readyPath) {
      const readiness = await healthRegistry.checkReadiness();
      res.statusCode = readiness.ready ? 200 : 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(readiness));
      return;
    }

    // Liveness endpoint
    if (url === livePath) {
      const liveness = await healthRegistry.checkLiveness();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(liveness));
      return;
    }

    next?.();
  };
}

/**
 * Create Express/Fastify middleware for metrics endpoint (Prometheus format)
 */
export function createMetricsMiddleware(
  metricsCollector: MetricsCollector,
  options: { path?: string } = {}
) {
  const { path = '/metrics' } = options;

  return async (req: { url: string }, res: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (data: string) => void;
  }, next?: () => void): Promise<void> => {
    if (req.url !== path) {
      next?.();
      return;
    }

    // Generate Prometheus format output
    const output: string[] = [];
    const aggregations = metricsCollector.getAllAggregations();

    for (const [_key, agg] of aggregations) {
      output.push(`# HELP ${agg.name} Metric`);
      output.push(`# TYPE ${agg.name} gauge`);
      output.push(`${agg.name}{aggregation="avg"} ${agg.avg}`);
      output.push(`${agg.name}{aggregation="sum"} ${agg.sum}`);
      output.push(`${agg.name}{aggregation="count"} ${agg.count}`);
      output.push(`${agg.name}{aggregation="min"} ${agg.min}`);
      output.push(`${agg.name}{aggregation="max"} ${agg.max}`);
      
      if (agg.percentiles) {
        for (const [p, v] of Object.entries(agg.percentiles)) {
          output.push(`${agg.name}{aggregation="${p}"} ${v}`);
        }
      }
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end(output.join('\n'));
  };
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

/**
 * Gracefully shutdown all monitoring components
 */
export async function shutdownMonitoring(): Promise<void> {
  logger.info('Shutting down monitoring components...');

  // Stop business KPIs
  try {
    const { getBusinessKpis } = await import('./business-kpis');
    const kpis = getBusinessKpis();
    kpis.stop();
    logger.info('✓ Business KPIs stopped');
  } catch (error) {
    logger.warn('Business KPIs shutdown skipped or failed', { error: error instanceof Error ? error.message : String(error) });
  }

  // Stop SLO tracker
  try {
    const { getSloTracker } = await import('./slo-tracker');
    const tracker = getSloTracker();
    tracker.stop();
    logger.info('✓ SLO tracker stopped');
  } catch (error) {
    logger.warn('SLO tracker shutdown skipped or failed', { error: error instanceof Error ? error.message : String(error) });
  }

  // Stop resource metrics
  try {
    const { getResourceMetrics } = await import('./resource-metrics');
    const resourceMetrics = getResourceMetrics();
    resourceMetrics.stop();
    logger.info('✓ Resource metrics stopped');
  } catch (error) {
    logger.warn('Resource metrics shutdown skipped or failed', { error: error instanceof Error ? error.message : String(error) });
  }

  // Stop alerting
  try {
    const { getAlertRules } = await import('./alerting-rules');
    const engine = getAlertRules();
    engine.stop();
    logger.info('✓ Alerting stopped');
  } catch (error) {
    // P2-11 FIX: Log errors during shutdown instead of silently swallowing
    logger.warn('Alerting shutdown skipped or failed', { error: error instanceof Error ? error.message : String(error) });
  }

  // Stop metrics
  try {
    const { getMetricsCollector } = await import('./metrics-collector');
    const collector = getMetricsCollector();
    collector.stop();
    logger.info('✓ Metrics stopped');
  } catch (error) {
    logger.warn('Metrics shutdown skipped or failed', { error: error instanceof Error ? error.message : String(error) });
  }

  // Cleanup health checks
  try {
    const { getHealthChecks } = await import('./health-checks');
    const registry = getHealthChecks();
    registry.cleanup();
    logger.info('✓ Health checks cleaned up');
  } catch (error) {
    logger.warn('Health checks cleanup skipped or failed', { error: error instanceof Error ? error.message : String(error) });
  }

  // Shutdown telemetry
  try {
    await shutdownTelemetry();
    logger.info('✓ Telemetry shutdown');
  } catch (error) {
    logger.warn('Telemetry shutdown skipped or failed', { error: error instanceof Error ? error.message : String(error) });
  }

  logger.info('✓ All monitoring components shutdown');
}
