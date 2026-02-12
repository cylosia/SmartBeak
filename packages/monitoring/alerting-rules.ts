/**
 * Alerting Rules Configuration Module
 * 
 * Implements comprehensive alerting:
 * - Latency alerts
 * - Error rate alerts
 * - Business metric alerts
 * - Infrastructure alerts
 */

import { EventEmitter } from 'events';
import { getLogger } from '@kernel/logger';
import { Pool } from 'pg';
import { MetricsCollector, getMetricsCollector } from './metrics-collector';

const logger = getLogger('alerting-rules');

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Alert severity levels
 */
export type AlertSeverity = 'info' | 'warning' | 'critical' | 'emergency';

/**
 * Alert status
 */
export type AlertStatus = 'firing' | 'resolved' | 'acknowledged' | 'suppressed';

/**
 * Alert notification channel
 */
export type AlertChannel = 'email' | 'slack' | 'webhook' | 'pagerduty' | 'sms';

/**
 * Alert condition operators
 */
export type AlertOperator = 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'neq';

/**
 * Alert aggregation
 */
export type AlertAggregation = 'avg' | 'sum' | 'min' | 'max' | 'count' | 'rate';

/**
 * Alert rule definition
 */
export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  category: AlertCategory;
  severity: AlertSeverity;
  
  // Condition
  metric: string;
  operator: AlertOperator;
  threshold: number;
  aggregation?: AlertAggregation;
  aggregationWindow?: string; // e.g., '5m', '1h'
  
  // Timing
  duration?: string; // Must persist for this duration
  cooldown?: string; // Minimum time between alerts
  
  // Routing
  channels: AlertChannel[];
  
  // Metadata
  enabled: boolean;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  
  // Runtime state
  lastEvaluated?: Date;
  lastFired?: Date;
  firingSince?: Date | undefined;
}

/**
 * Alert category
 */
export type AlertCategory = 
  | 'latency' 
  | 'error_rate' 
  | 'business' 
  | 'infrastructure' 
  | 'availability'
  | 'security';

/**
 * Firing alert instance
 */
export interface AlertInstance {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  category: AlertCategory;
  status: AlertStatus;
  message: string;
  value: number;
  threshold: number;
  startedAt: Date;
  resolvedAt?: Date;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

/**
 * Notification payload
 */
export interface NotificationPayload {
  alert: AlertInstance;
  rule: AlertRule;
  timestamp: string;
}

/**
 * Notification handler
 */
export type NotificationHandler = (payload: NotificationPayload) => Promise<void>;

/**
 * Alerting configuration
 */
export interface AlertingConfig {
  evaluationInterval?: string;
  db?: Pool;
  metricsCollector?: MetricsCollector;
}

// ============================================================================
// Default Alert Rules
// ============================================================================

export const defaultAlertRules: AlertRule[] = [
  // ==========================================================================
  // Latency Alerts
  // ==========================================================================
  {
    id: 'latency-api-p95',
    name: 'API P95 Latency High',
    description: 'API 95th percentile latency exceeds threshold',
    category: 'latency',
    severity: 'warning',
    metric: 'business.api_duration',
    operator: 'gt',
    threshold: 500, // 500ms
    aggregation: 'avg',
    aggregationWindow: '5m',
    duration: '5m',
    cooldown: '15m',
    channels: ['slack', 'webhook'],
    enabled: true,
    annotations: {
      summary: 'API latency is high',
      runbook_url: 'https://wiki.internal/runbooks/high-latency',
    },
  },
  {
    id: 'latency-api-p99',
    name: 'API P99 Latency Critical',
    description: 'API 99th percentile latency exceeds critical threshold',
    category: 'latency',
    severity: 'critical',
    metric: 'business.api_duration',
    operator: 'gt',
    threshold: 1000, // 1s
    aggregation: 'avg',
    aggregationWindow: '5m',
    duration: '3m',
    cooldown: '10m',
    channels: ['slack', 'webhook', 'pagerduty'],
    enabled: true,
    annotations: {
      summary: 'API latency is critically high',
      runbook_url: 'https://wiki.internal/runbooks/critical-latency',
    },
  },
  {
    id: 'latency-db-query',
    name: 'Database Query Latency High',
    description: 'Database query latency exceeds threshold',
    category: 'latency',
    severity: 'warning',
    metric: 'system.db.query_duration',
    operator: 'gt',
    threshold: 100, // 100ms
    aggregation: 'avg',
    aggregationWindow: '5m',
    duration: '5m',
    cooldown: '15m',
    channels: ['slack'],
    enabled: true,
  },

  // ==========================================================================
  // Error Rate Alerts
  // ==========================================================================
  {
    id: 'error-rate-api-warning',
    name: 'API Error Rate Warning',
    description: 'API error rate exceeds warning threshold',
    category: 'error_rate',
    severity: 'warning',
    metric: 'business.api_calls',
    operator: 'gt',
    threshold: 0.01, // 1%
    aggregation: 'rate',
    aggregationWindow: '5m',
    duration: '5m',
    cooldown: '15m',
    channels: ['slack'],
    enabled: true,
    labels: { status: '5xx' },
  },
  {
    id: 'error-rate-api-critical',
    name: 'API Error Rate Critical',
    description: 'API error rate exceeds critical threshold',
    category: 'error_rate',
    severity: 'critical',
    metric: 'business.api_calls',
    operator: 'gt',
    threshold: 0.05, // 5%
    aggregation: 'rate',
    aggregationWindow: '5m',
    duration: '3m',
    cooldown: '10m',
    channels: ['slack', 'webhook', 'pagerduty'],
    enabled: true,
    labels: { status: '5xx' },
  },
  {
    id: 'error-rate-jobs',
    name: 'Job Failure Rate High',
    description: 'Background job failure rate is high',
    category: 'error_rate',
    severity: 'warning',
    metric: 'business.jobs_failed',
    operator: 'gt',
    threshold: 0.1, // 10%
    aggregation: 'rate',
    aggregationWindow: '10m',
    duration: '5m',
    cooldown: '15m',
    channels: ['slack'],
    enabled: true,
  },

  // ==========================================================================
  // Business Metric Alerts
  // ==========================================================================
  {
    id: 'business-signup-drop',
    name: 'User Signup Rate Drop',
    description: 'User signup rate has dropped significantly',
    category: 'business',
    severity: 'warning',
    metric: 'business.user_signups',
    operator: 'lt',
    threshold: 10, // Less than 10 signups
    aggregation: 'sum',
    aggregationWindow: '1h',
    duration: '1h',
    cooldown: '2h',
    channels: ['slack'],
    enabled: true,
  },
  {
    id: 'business-payment-failures',
    name: 'Payment Failure Rate High',
    description: 'Payment processing failure rate is high',
    category: 'business',
    severity: 'critical',
    metric: 'business.payments_processed',
    operator: 'gt',
    threshold: 0.1, // 10% failure rate
    aggregation: 'rate',
    aggregationWindow: '15m',
    duration: '10m',
    cooldown: '30m',
    channels: ['slack', 'email', 'pagerduty'],
    enabled: true,
    labels: { status: 'failed' },
  },
  {
    id: 'business-revenue-drop',
    name: 'Revenue Drop Alert',
    description: 'Hourly revenue has dropped significantly compared to average',
    category: 'business',
    severity: 'warning',
    metric: 'business.revenue_amount',
    operator: 'lt',
    threshold: 0.5, // 50% of expected
    aggregation: 'sum',
    aggregationWindow: '1h',
    duration: '1h',
    cooldown: '2h',
    channels: ['slack', 'email'],
    enabled: true,
  },

  // ==========================================================================
  // Infrastructure Alerts
  // ==========================================================================
  {
    id: 'infra-cpu-high',
    name: 'CPU Usage High',
    description: 'CPU usage is consistently high',
    category: 'infrastructure',
    severity: 'warning',
    metric: 'system.cpu.used_percent',
    operator: 'gt',
    threshold: 80,
    aggregation: 'avg',
    aggregationWindow: '5m',
    duration: '5m',
    cooldown: '15m',
    channels: ['slack'],
    enabled: true,
  },
  {
    id: 'infra-memory-critical',
    name: 'Memory Usage Critical',
    description: 'Memory usage has reached critical levels',
    category: 'infrastructure',
    severity: 'critical',
    metric: 'system.memory.used_percent',
    operator: 'gt',
    threshold: 90,
    aggregation: 'avg',
    aggregationWindow: '5m',
    duration: '3m',
    cooldown: '10m',
    channels: ['slack', 'webhook'],
    enabled: true,
  },
  {
    id: 'infra-event-loop-lag',
    name: 'Event Loop Lag High',
    description: 'Node.js event loop lag is high',
    category: 'infrastructure',
    severity: 'warning',
    metric: 'system.event_loop.lag_ms',
    operator: 'gt',
    threshold: 50,
    aggregation: 'avg',
    aggregationWindow: '1m',
    duration: '2m',
    cooldown: '10m',
    channels: ['slack'],
    enabled: true,
  },
  {
    id: 'infra-disk-space',
    name: 'Disk Space Low',
    description: 'Available disk space is low',
    category: 'infrastructure',
    severity: 'warning',
    metric: 'system.disk.used_percent',
    operator: 'gt',
    threshold: 85,
    aggregation: 'avg',
    aggregationWindow: '5m',
    duration: '5m',
    cooldown: '1h',
    channels: ['slack', 'email'],
    enabled: true,
  },

  // ==========================================================================
  // Availability Alerts
  // ==========================================================================
  {
    id: 'availability-db',
    name: 'Database Unavailable',
    description: 'Database health check is failing',
    category: 'availability',
    severity: 'critical',
    metric: 'health.database',
    operator: 'eq',
    threshold: 0, // unhealthy
    duration: '1m',
    cooldown: '5m',
    channels: ['slack', 'pagerduty'],
    enabled: true,
  },
  {
    id: 'availability-redis',
    name: 'Redis Unavailable',
    description: 'Redis health check is failing',
    category: 'availability',
    severity: 'critical',
    metric: 'health.redis',
    operator: 'eq',
    threshold: 0, // unhealthy
    duration: '1m',
    cooldown: '5m',
    channels: ['slack', 'webhook'],
    enabled: true,
  },
];

// ============================================================================
// Alert Rules Engine
// ============================================================================

export class AlertRulesEngine extends EventEmitter {
  private readonly rules: Map<string, AlertRule> = new Map();
  private readonly activeAlerts: Map<string, AlertInstance> = new Map();
  private readonly notificationHandlers: Map<AlertChannel, NotificationHandler[]> = new Map();
  private evaluationInterval: NodeJS.Timeout | undefined;
  private readonly db: Pool | undefined;
  private readonly metricsCollector: MetricsCollector | undefined;

  constructor(config: AlertingConfig = {}) {
    super();
    this.db = config.db;
    this.metricsCollector = config.metricsCollector;
  }

  /**
   * Start the alert rules engine
   */
  start(evaluationIntervalMs: number = 60000): void {
    if (this.evaluationInterval) {
      return;
    }

    // Load default rules
    for (const rule of defaultAlertRules) {
      this.addRule(rule);
    }

    // Start evaluation
    this.evaluationInterval = setInterval(() => {
      this.evaluateAll();
    }, evaluationIntervalMs).unref();

    logger.info('Alert rules engine started', { 
      rulesCount: this.rules.size,
      intervalMs: evaluationIntervalMs 
    });
  }

  /**
   * Stop the alert rules engine
   */
  stop(): void {
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
      this.evaluationInterval = undefined;
    }
    logger.info('Alert rules engine stopped');
  }

  /**
   * Add a new alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
    logger.debug(`Alert rule added: ${rule.name}`);
  }

  /**
   * Remove an alert rule
   */
  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
    // Also clear any active alerts for this rule
    for (const [id, alert] of this.activeAlerts) {
      if (alert.ruleId === ruleId) {
        this.activeAlerts.delete(id);
      }
    }
  }

  /**
   * Enable/disable a rule
   */
  setRuleEnabled(ruleId: string, enabled: boolean): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = enabled;
    }
  }

  /**
   * Register a notification handler
   */
  registerNotificationHandler(
    channel: AlertChannel,
    handler: NotificationHandler
  ): void {
    if (!this.notificationHandlers.has(channel)) {
      this.notificationHandlers.set(channel, []);
    }
    this.notificationHandlers.get(channel)!.push(handler);
  }

  // ==========================================================================
  // Evaluation
  // ==========================================================================

  /**
   * Evaluate all enabled rules
   */
  async evaluateAll(): Promise<void> {
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      try {
        await this.evaluateRule(rule);
      } catch (error) {
        logger.error(`Failed to evaluate rule ${rule.id}`, error as Error);
      }
    }
  }

  /**
   * Evaluate a single rule
   */
  private async evaluateRule(rule: AlertRule): Promise<void> {
    const value = await this.getMetricValue(rule);
    const shouldFire = this.evaluateCondition(value, rule.operator, rule.threshold);

    rule.lastEvaluated = new Date();

    const alertKey = this.getAlertKey(rule);
    const existingAlert = this.activeAlerts.get(alertKey);

    if (shouldFire) {
      if (!existingAlert) {
        // Check duration requirement
        if (rule.duration) {
          if (!rule.firingSince) {
            rule.firingSince = new Date();
            return;
          }
          
          const durationMs = this.parseDuration(rule.duration);
          if (Date.now() - rule.firingSince.getTime() < durationMs) {
            return; // Duration not met yet
          }
        }

        // Fire new alert
        await this.fireAlert(rule, value);
      }
    } else {
      // Clear firing state
      rule.firingSince = undefined;
      
      // Resolve existing alert
      if (existingAlert && existingAlert.status === 'firing') {
        await this.resolveAlert(existingAlert);
      }
    }
  }

  /**
   * Get metric value for rule evaluation
   */
  private async getMetricValue(rule: AlertRule): Promise<number> {
    // Try metrics collector first
    if (this.metricsCollector) {
      const agg = this.metricsCollector.getAggregation(rule.metric, rule.labels);
      if (agg) {
        switch (rule.aggregation) {
          case 'avg':
            return agg.avg;
          case 'sum':
            return agg.sum;
          case 'min':
            return agg.min;
          case 'max':
            return agg.max;
          case 'count':
            return agg.count;
          default:
            return agg.avg;
        }
      }
    }

    // Check health metrics
    if (rule.metric.startsWith('health.')) {
      return this.getHealthMetricValue(rule.metric);
    }

    // Fallback to direct query
    const latest = this.metricsCollector?.getLatestMetricValue(rule.metric, rule.labels);
    return latest ?? 0;
  }

  /**
   * Get health metric value
   */
  private getHealthMetricValue(metric: string): number {
    // This would integrate with health checks
    // Returns 1 for healthy, 0 for unhealthy
    return 1; // Default to healthy
  }

  /**
   * Evaluate condition
   */
  private evaluateCondition(
    value: number,
    operator: AlertOperator,
    threshold: number
  ): boolean {
    switch (operator) {
      case 'gt':
        return value > threshold;
      case 'lt':
        return value < threshold;
      case 'eq':
        return value === threshold;
      case 'gte':
        return value >= threshold;
      case 'lte':
        return value <= threshold;
      case 'neq':
        return value !== threshold;
      default:
        return false;
    }
  }

  // ==========================================================================
  // Alert Lifecycle
  // ==========================================================================

  /**
   * Fire a new alert
   */
  private async fireAlert(rule: AlertRule, value: number): Promise<void> {
    // Check cooldown
    if (rule.lastFired && rule.cooldown) {
      const cooldownMs = this.parseDuration(rule.cooldown);
      if (Date.now() - rule.lastFired.getTime() < cooldownMs) {
        return; // In cooldown
      }
    }

    const alert: AlertInstance = {
      // P2-FIX: Use crypto.randomBytes for consistent ID generation
      id: `alert_${Date.now()}_${require('crypto').randomBytes(6).toString('hex')}`,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      category: rule.category,
      status: 'firing',
      message: this.buildAlertMessage(rule, value),
      value,
      threshold: rule.threshold,
      startedAt: new Date(),
      labels: rule.labels ?? {},
      annotations: rule.annotations ?? {},
    };

    const alertKey = this.getAlertKey(rule);
    this.activeAlerts.set(alertKey, alert);
    rule.lastFired = new Date();

    // Persist to database
    await this.persistAlert(alert);

    // Send notifications
    await this.sendNotifications(alert, rule);

    this.emit('alert', alert);
    logger.info(`Alert fired: ${rule.name}`, { alertId: alert.id, value });
  }

  /**
   * Resolve an alert
   */
  private async resolveAlert(alert: AlertInstance): Promise<void> {
    alert.status = 'resolved';
    alert.resolvedAt = new Date();

    await this.updateAlert(alert);

    this.emit('resolved', alert);
    logger.info(`Alert resolved: ${alert.ruleName}`, { alertId: alert.id });
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(
    alertId: string,
    userId: string
  ): Promise<AlertInstance | undefined> {
    for (const alert of this.activeAlerts.values()) {
      if (alert.id === alertId) {
        alert.status = 'acknowledged';
        alert.acknowledgedBy = userId;
        alert.acknowledgedAt = new Date();

        await this.updateAlert(alert);
        
        this.emit('acknowledged', alert);
        logger.info(`Alert acknowledged: ${alert.ruleName}`, { 
          alertId, 
          userId 
        });

        return alert;
      }
    }
    return undefined;
  }

  /**
   * Build alert message
   */
  private buildAlertMessage(rule: AlertRule, value: number): string {
    const operatorMap: Record<AlertOperator, string> = {
      gt: '>',
      lt: '<',
      eq: '==',
      gte: '>=',
      lte: '<=',
      neq: '!=',
    };

    return `${rule.name}: ${rule.metric} = ${value.toFixed(2)} ` +
           `${operatorMap[rule.operator]} ${rule.threshold}`;
  }

  /**
   * Get alert key for deduplication
   */
  private getAlertKey(rule: AlertRule): string {
    const labels = rule.labels 
      ? Object.entries(rule.labels).map(([k, v]) => `${k}=${v}`).join(',')
      : '';
    return `${rule.id}:${labels}`;
  }

  // ==========================================================================
  // Notifications
  // ==========================================================================

  /**
   * Send notifications for an alert
   */
  private async sendNotifications(
    alert: AlertInstance,
    rule: AlertRule
  ): Promise<void> {
    const payload: NotificationPayload = {
      alert,
      rule,
      timestamp: new Date().toISOString(),
    };

    for (const channel of rule.channels) {
      const handlers = this.notificationHandlers.get(channel) || [];
      
      for (const handler of handlers) {
        try {
          await handler(payload);
        } catch (error) {
          logger.error(`Notification handler failed for ${channel}`, error as Error);
        }
      }
    }
  }

  // ==========================================================================
  // Database Persistence
  // ==========================================================================

  /**
   * Persist alert to database
   */
  private async persistAlert(alert: AlertInstance): Promise<void> {
    if (!this.db) return;

    try {
      await this.db.query(
        `INSERT INTO alert_instances 
         (id, rule_id, rule_name, severity, category, status, message, 
          value, threshold, started_at, labels, annotations)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          alert.id,
          alert.ruleId,
          alert.ruleName,
          alert.severity,
          alert.category,
          alert.status,
          alert.message,
          alert.value,
          alert.threshold,
          alert.startedAt,
          JSON.stringify(alert.labels),
          JSON.stringify(alert.annotations),
        ]
      );
    } catch (error) {
      logger.error('Failed to persist alert', error as Error);
    }
  }

  /**
   * Update alert in database
   */
  private async updateAlert(alert: AlertInstance): Promise<void> {
    if (!this.db) return;

    try {
      await this.db.query(
        `UPDATE alert_instances 
         SET status = $1, resolved_at = $2, acknowledged_by = $3, acknowledged_at = $4
         WHERE id = $5`,
        [
          alert.status,
          alert.resolvedAt,
          alert.acknowledgedBy,
          alert.acknowledgedAt,
          alert.id,
        ]
      );
    } catch (error) {
      logger.error('Failed to update alert', error as Error);
    }
  }

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  /**
   * Get all active alerts
   */
  getActiveAlerts(): AlertInstance[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Get alerts by category
   */
  getAlertsByCategory(category: AlertCategory): AlertInstance[] {
    return this.getActiveAlerts().filter(a => a.category === category);
  }

  /**
   * Get alerts by severity
   */
  getAlertsBySeverity(severity: AlertSeverity): AlertInstance[] {
    return this.getActiveAlerts().filter(a => a.severity === severity);
  }

  /**
   * Get all rules
   */
  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Parse duration string to milliseconds
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 0;

    const value = parseInt(match[1]!);
    const unit = match[2]!;

    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 0;
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalEngine: AlertRulesEngine | null = null;

/**
 * Initialize global alert rules engine
 */
export function initAlertRules(config?: AlertingConfig): AlertRulesEngine {
  if (!globalEngine) {
    globalEngine = new AlertRulesEngine(config);
  }
  return globalEngine;
}

/**
 * Get global alert rules engine
 */
export function getAlertRules(): AlertRulesEngine {
  if (!globalEngine) {
    throw new Error('Alert rules engine not initialized. Call initAlertRules first.');
  }
  return globalEngine;
}

// ============================================================================
// Built-in Notification Handlers
// ============================================================================

/**
 * Create Slack notification handler
 */
export function createSlackHandler(
  webhookUrl: string
): NotificationHandler {
  return async (payload: NotificationPayload) => {
    const { alert, rule } = payload;
    
    const colors: Record<AlertSeverity, string> = {
      info: '#36a64f',
      warning: '#ff9900',
      critical: '#ff0000',
      emergency: '#990000',
    };

    const slackPayload = {
      attachments: [
        {
          color: colors[alert.severity],
          title: `[${alert.severity.toUpperCase()}] ${alert.ruleName}`,
          text: alert.message,
          fields: [
            {
              title: 'Category',
              value: alert.category,
              short: true,
            },
            {
              title: 'Value',
              value: alert.value.toFixed(2),
              short: true,
            },
            {
              title: 'Threshold',
              value: alert.threshold.toString(),
              short: true,
            },
          ],
          footer: 'SmartBeak Alerting',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.statusText}`);
    }
  };
}

/**
 * Create webhook notification handler
 */
export function createWebhookHandler(
  url: string,
  headers?: Record<string, string>
): NotificationHandler {
  return async (payload: NotificationPayload) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.statusText}`);
    }
  };
}

/**
 * Create email notification handler
 */
export function createEmailHandler(
  toAddresses: string[]
): NotificationHandler {
  return async (payload: NotificationPayload) => {
    // This would integrate with EmailAdapter
    logger.info(`[Alert:Email] ${payload.alert.ruleName} to ${toAddresses.join(', ')}`);
  };
}
