import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

import { LRUCache } from '../utils/lruCache';

import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';


/**
* Monitoring & Alerting System
* Tracks system health, costs, and sends alerts for anomalies
*/

const logger = getLogger('alerting');

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertChannel = 'email' | 'slack' | 'webhook' | 'sms';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  category: 'cost' | 'performance' | 'security' | 'job_failure' | 'api_health';
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  acknowledged: boolean;
  acknowledgedBy?: string;
  createdAt: Date;
}

export interface AlertRule {
  id: string;
  name: string;
  category: Alert['category'];
  severity: AlertSeverity;
  condition: {
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  threshold: number;
  duration?: number; // seconds the condition must persist
  };
  channels: AlertChannel[];
  cooldown: number; // seconds between alerts
  enabled: boolean;
}

export interface CostAlert {
  orgId: string;
  dailySpend: number;
  budgetLimit: number;
  percentageUsed: number;
  projectedMonthly: number;
}

export class AlertingSystem extends EventEmitter {
  private readonly db: Pool;
  private readonly rules = new LRUCache<string, AlertRule>({ maxSize: 1000, ttlMs: undefined });
  private readonly alertHistory = new LRUCache<string, Date>({ maxSize: 10000, ttlMs: 86400000 }); // ruleId -> lastAlertTime
  private checkInterval?: NodeJS.Timeout;

  constructor(db: Pool) {
  super();
  // P2-FIX: Set max listeners to prevent Node.js memory leak warnings
  this.setMaxListeners(50);
  this.db = db;
  this.loadDefaultRules();
  }

  /**
  * Load default alert rules into the system
  */
  private loadDefaultRules(): void {
  const defaults: AlertRule[] = [
    {
    id: 'cost-daily-80',
    name: 'Daily Cost 80%',
    category: 'cost',
    severity: 'warning',
    condition: { metric: 'daily_cost_pct', operator: 'gte', threshold: 80 },
    channels: ['email'],
    cooldown: 86400,
    enabled: true,
    },
    {
    id: 'cost-daily-100',
    name: 'Daily Cost 100%',
    category: 'cost',
    severity: 'critical',
    condition: { metric: 'daily_cost_pct', operator: 'gte', threshold: 100 },
    channels: ['email', 'slack'],
    cooldown: 3600,
    enabled: true,
    },
    {
    id: 'job-failure-rate',
    name: 'High Job Failure Rate',
    category: 'job_failure',
    severity: 'warning',
    condition: { metric: 'job_failure_rate', operator: 'gte', threshold: 0.1, duration: 300 },
    channels: ['email', 'slack'],
    cooldown: 1800,
    enabled: true,
    },
    {
    id: 'api-error-rate',
    name: 'High API Error Rate',
    category: 'api_health',
    severity: 'critical',
    condition: { metric: 'api_error_rate', operator: 'gte', threshold: 0.25, duration: 180 },
    channels: ['email', 'slack', 'webhook'],
    cooldown: 600,
    enabled: true,
    },
    {
    id: 'queue-backlog',
    name: 'Queue Backlog Critical',
    category: 'performance',
    severity: 'warning',
    condition: { metric: 'queue_backlog', operator: 'gte', threshold: 1000 },
    channels: ['email', 'slack'],
    cooldown: 900,
    enabled: true,
    },
    {
    id: 'security-failed-login',
    name: 'Multiple Failed Logins',
    category: 'security',
    severity: 'critical',
    condition: { metric: 'failed_logins', operator: 'gte', threshold: 10, duration: 300 },
    channels: ['email', 'slack', 'webhook'],
    cooldown: 300,
    enabled: true,
    },
  ];

  for (const rule of defaults) {
    this.rules.set(rule.id, rule);
  }
  }

  /**
  * Start monitoring checks
  * @param checkIntervalMs - Interval between checks in milliseconds (default: 60000)
  */
  start(checkIntervalMs: number = 60000): void {
  this.checkInterval = setInterval(() => {
    void this.runChecks();
  }, checkIntervalMs).unref();
  logger.info('[Alerting] Started monitoring');
  }

  /**
  * Stop monitoring
  */
  stop(): void {
  if (this.checkInterval) {
    clearInterval(this.checkInterval);
  }
  }

  /**
  * Run all alert checks
  */
  private async runChecks(): Promise<void> {
  for (const rule of this.rules.values()) {
    if (!rule.enabled) continue;

    try {
    const metric = await this.getMetricValue(rule.condition.metric);
    const triggered = this.evaluateCondition(metric, rule.condition);

    if (triggered) {
    await this.triggerAlert(rule, metric);
    }
    } catch (error) {
    logger.error(`[Alerting] Check failed for ${rule.id}:`, error instanceof Error ? error : new Error(String(error)));
    }
  }
  }

  /**
  * Get current metric value
  */
  private async getMetricValue(metric: string): Promise<number> {
  switch (metric) {
    case 'daily_cost_pct':
    return this.getDailyCostPercentage();
    case 'job_failure_rate':
    return this.getJobFailureRate();
    case 'api_error_rate':
    return this.getApiErrorRate();
    case 'queue_backlog':
    return this.getQueueBacklog();
    case 'failed_logins':
    return this.getFailedLogins();
    default:
    return 0;
  }
  }

  /**
  * Evaluate alert condition
  */
  private evaluateCondition(
  value: number,
  condition: AlertRule['condition']
  ): boolean {
  switch (condition.operator) {
    case 'gt':
    return value > condition.threshold;
    case 'lt':
    return value < condition.threshold;
    case 'eq':
    return value === condition.threshold;
    case 'gte':
    return value >= condition.threshold;
    case 'lte':
    return value <= condition.threshold;
    default:
    return false;
  }
  }

  /**
  * Trigger an alert
  */
  private async triggerAlert(rule: AlertRule, value: number): Promise<void> {
  // Check cooldown
  const lastAlert = this.alertHistory.get(rule.id);
  if (lastAlert && Date.now() - lastAlert.getTime() < rule.cooldown * 1000) {
    return;
  }

  const alert: Alert = {
    id: `alert_${Date.now()}_${randomBytes(6).toString('hex')}`,
    severity: rule.severity,
    category: rule.category,
    title: rule.name,
    message: `${rule.name}: ${rule.condition.metric} = ${value.toFixed(2)} (threshold: ${rule.condition.threshold})`,
    metadata: { ruleId: rule.id, value, threshold: rule.condition.threshold },
    acknowledged: false,
    createdAt: new Date(),
  };

  // Store alert
  await this.storeAlert(alert);

  // Send notifications
  for (const channel of rule.channels) {
    await this.sendNotification(channel, alert);
  }

  // Update history
  this.alertHistory.set(rule.id, new Date());

  // Emit event
  this.emit('alert', alert);
  }

  /**
  * Store alert in database
  */
  private async storeAlert(alert: Alert): Promise<void> {
  await this.db.query(
    `INSERT INTO alerts (id, severity, category, title, message, metadata, acknowledged, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
    alert.id,
    alert.severity,
    alert.category,
    alert.title,
    alert.message,
    JSON.stringify(alert.metadata),
    alert.acknowledged,
    alert.createdAt,
    ]
  );
  }

  /**
  * Send notification to channel
  */
  private async sendNotification(channel: AlertChannel, alert: Alert): Promise<void> {
  switch (channel) {
    case 'email':
    await this.sendEmailAlert(alert);
    break;
    case 'slack':
    await this.sendSlackAlert(alert);
    break;
    case 'webhook':
    await this.sendWebhookAlert(alert);
    break;
    case 'sms':
    await this.sendSmsAlert(alert);
    break;
  }
  }

  /**
  * Send email alert
  */
  private async sendEmailAlert(alert: Alert): Promise<void> {
  // Would integrate with EmailAdapter
  logger.info(`[Alert:Email] ${alert.severity}: ${alert.title}`);
  }

  /**
  * Send Slack alert
  */
  private async sendSlackAlert(alert: Alert): Promise<void> {
  const webhookUrl = process.env['SLACK_WEBHOOK_URL'];
  if (!webhookUrl) return;

  const colors: Record<AlertSeverity, string> = {
    info: '#36a64f',
    warning: '#ff9900',
    critical: '#ff0000',
  };

  const payload = {
    attachments: [
    {
    color: colors[alert.severity],
    title: `[${alert.severity.toUpperCase()}] ${alert.title}`,
    text: alert.message,
    footer: 'SmartBeak Monitoring',
    ts: Math.floor(alert.createdAt.getTime() / 1000),
    },
    ],
  };

  try {
    // P1-FIX: Add timeout to prevent hanging on unresponsive webhook endpoints
    await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    logger.error('[Alert:Slack] Failed to send:', error instanceof Error ? error : new Error(String(error)));
  }
  }

  /**
  * Send webhook alert
  */
  private async sendWebhookAlert(alert: Alert): Promise<void> {
  const webhookUrl = process.env['ALERT_WEBHOOK_URL'];
  if (!webhookUrl) return;

  try {
    // P1-FIX: Add timeout to prevent hanging on unresponsive webhook endpoints
    await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(alert),
    signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    logger.error('[Alert:Webhook] Failed to send:', error instanceof Error ? error : new Error(String(error)));
  }
  }

  /**
  * Send SMS alert
  */
  private async sendSmsAlert(alert: Alert): Promise<void> {
  // Would integrate with Twilio or similar
  if (alert.severity !== 'critical') return;
  logger.info(`[Alert:SMS] ${alert.title}`);
  }

  /**
  * Get daily cost percentage of budget
  */
  private async getDailyCostPercentage(): Promise<number> {
  const { rows } = await this.db.query(
    `SELECT
    COALESCE(SUM(cost), 0) as daily_cost,
    COALESCE(AVG(daily_budget), 100) as budget
    FROM cost_tracking
    WHERE date = CURRENT_DATE`
  );

  const dailyCost = parseFloat(rows[0]?.daily_cost || 0);
  const budget = parseFloat(rows[0]?.budget || 100);

  return budget > 0 ? (dailyCost / budget) * 100 : 0;
  }

  /**
  * Get job failure rate (last hour)
  */
  private async getJobFailureRate(): Promise<number> {
  const { rows } = await this.db.query(
    `SELECT
    COUNT(*) FILTER (WHERE status = 'failed') as failed,
    COUNT(*) as total
    FROM job_executions
    WHERE created_at >= NOW() - INTERVAL '1 hour'`
  );

  const failed = parseInt(rows[0]?.failed || 0);
  const total = parseInt(rows[0]?.total || 0);

  return total > 0 ? failed / total : 0;
  }

  /**
  * Get API error rate (last 10 minutes)
  */
  private async getApiErrorRate(): Promise<number> {
  const { rows } = await this.db.query(
    `SELECT
    COUNT(*) FILTER (WHERE status_code >= 500 OR error IS NOT NULL) as errors,
    COUNT(*) as total
    FROM api_request_logs
    WHERE created_at >= NOW() - INTERVAL '10 minutes'`
  );

  const errors = parseInt(rows[0]?.errors || 0);
  const total = parseInt(rows[0]?.total || 0);

  return total > 0 ? errors / total : 0;
  }

  /**
  * P1-FIX: Get queue backlog from BullMQ using SCAN instead of KEYS
  * Previously used KEYS which blocks Redis - now uses SCAN for non-blocking iteration
  */
  private async getQueueBacklog(): Promise<number> {
    try {
      const { Queue } = await import('bullmq');
      const { getRedis } = await import('@kernel/redis');
      const redis = await getRedis();
      
      // P1-FIX: Use SCAN instead of KEYS to avoid blocking Redis
      const queueKeys: string[] = [];
      let cursor = '0';
      const BATCH_SIZE = 100;
      
      do {
        const result = await redis.scan(cursor, 'MATCH', 'bull:*:id', 'COUNT', BATCH_SIZE);
        cursor = result[0];
        queueKeys.push(...result[1]);
      } while (cursor !== '0');
      
      let totalBacklog = 0;
      
      for (const key of queueKeys) {
        const queueName = key.split(':')[1];
        if (queueName) {
          const queue = new Queue(queueName, { connection: redis as unknown as import('bullmq').ConnectionOptions });
          const count = await queue.getWaitingCount();
          totalBacklog += count;
          await queue.close();
        }
      }
      
      return totalBacklog;
    } catch (error) {
      logger.error('[alerting] Failed to get queue backlog:', error as Error);
      return 0;
    }
  }

  /**
  * P0-FIX: Get DLQ (Dead Letter Queue) size
  * Alert on failed jobs accumulating
  */
  private async getDLQSize(): Promise<number> {
    try {
      const { getDLQStorage } = await import('@kernel/dlq');
      const dlq = getDLQStorage();
      const messages = await (dlq as { getMessages?: () => Promise<unknown[]> }).getMessages?.() ?? [];
      return messages.length;
    } catch (error) {
      logger.error('[alerting] Failed to get DLQ size:', error as Error);
      return 0;
    }
  }

  /**
  * Get failed logins (last 5 minutes)
  */
  private async getFailedLogins(): Promise<number> {
  const { rows } = await this.db.query(
    `SELECT COUNT(*) as count
    FROM auth_attempts
    WHERE success = false
    AND created_at >= NOW() - INTERVAL '5 minutes'`
  );

  return parseInt(rows[0]?.count || 0);
  }

  /**
  * Acknowledge an alert
  */
  async acknowledgeAlert(alertId: string, userId: string): Promise<void> {
  await this.db.query(
    `UPDATE alerts SET acknowledged = true, acknowledged_by = $1, acknowledged_at = NOW()
    WHERE id = $2`,
    [userId, alertId]
  );
  }

  /**
  * Get recent alerts with optional filtering
  * @param severity - Filter by alert severity
  * @param category - Filter by alert category
  * @param limit - Maximum number of alerts to return (default: 50)
  * @returns Array of matching alerts
  */
  async getRecentAlerts(
  severity?: AlertSeverity,
  category?: Alert['category'],
  limit: number = 50
  ): Promise<Alert[]> {
  let query = `SELECT * FROM alerts WHERE 1=1`;
  const params: unknown[] = [];

  if (severity) {
    params.push(severity);
    query += ` AND severity = $${params.length}`;
  }

  if (category) {
    params.push(category);
    query += ` AND category = $${params.length}`;
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await this.db.query(query, params);

  return rows.map(r => ({
    id: r.id,
    severity: r.severity,
    category: r.category,
    title: r.title,
    message: r.message,
    metadata: r.metadata,
    acknowledged: r.acknowledged,
    acknowledgedBy: r.acknowledged_by,
    createdAt: r.created_at,
  }));
  }

  /**
  * Add custom alert rule
  */
  addRule(rule: Omit<AlertRule, 'id'>): AlertRule {
  const fullRule: AlertRule = {
    ...rule,
    id: `rule_${Date.now()}`,
  };
  this.rules.set(fullRule.id, fullRule);
  return fullRule;
  }

  /**
  * Update rule status
  */
  updateRule(ruleId: string, enabled: boolean): void {
  const rule = this.rules.get(ruleId);
  if (rule) {
    rule.enabled = enabled;
  }
  }
}
