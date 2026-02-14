/**
 * Business KPI Tracker
 *
 * Aggregates business-level metrics for publishing throughput, ingestion
 * success rate, notification delivery rate, and webhook processing.
 * Raw counters are emitted immediately; derived gauges (rates, throughput)
 * are computed on a periodic evaluation interval.
 */

import { getLogger } from '@kernel/logger';

import { MetricsCollector, getMetricsCollector } from './metrics-collector';

const logger = getLogger('business-kpis');

// ============================================================================
// Business KPI Tracker
// ============================================================================

interface WindowCounters {
  successes: number;
  failures: number;
  timestamps: number[];
}

export class BusinessKpiTracker {
  private readonly collector: MetricsCollector;
  private timer: ReturnType<typeof setInterval> | null = null;

  // Sliding window counters for rate computation
  private readonly publishCounters = new Map<string, WindowCounters>();
  private readonly ingestionCounters = new Map<string, WindowCounters>();
  private readonly notificationCounters = new Map<string, WindowCounters>();
  private readonly webhookCounters = new Map<string, WindowCounters>();

  constructor(collector: MetricsCollector) {
    this.collector = collector;
  }

  // ==========================================================================
  // Publishing KPIs
  // ==========================================================================

  recordPublishAttempt(platform: string): void {
    this.collector.counter('kpi.publishing.attempts_total', 1, { platform });
    this.ensureCounter(this.publishCounters, platform);
  }

  recordPublishSuccess(platform: string): void {
    this.collector.counter('kpi.publishing.success_total', 1, { platform });
    const c = this.ensureCounter(this.publishCounters, platform);
    c.successes++;
    c.timestamps.push(Date.now());
  }

  recordPublishFailure(platform: string, reason: string): void {
    this.collector.counter('kpi.publishing.failures_total', 1, { platform, reason });
    const c = this.ensureCounter(this.publishCounters, platform);
    c.failures++;
  }

  // ==========================================================================
  // Ingestion KPIs
  // ==========================================================================

  recordIngestionAttempt(source: string): void {
    this.collector.counter('kpi.ingestion.attempts_total', 1, { source });
    this.ensureCounter(this.ingestionCounters, source);
  }

  recordIngestionSuccess(source: string, count: number): void {
    this.collector.counter('kpi.ingestion.success_total', 1, { source });
    this.collector.counter('kpi.ingestion.items_total', count, { source, status: 'success' });
    const c = this.ensureCounter(this.ingestionCounters, source);
    c.successes++;
  }

  recordIngestionFailure(source: string, count: number): void {
    this.collector.counter('kpi.ingestion.failures_total', 1, { source });
    this.collector.counter('kpi.ingestion.items_total', count, { source, status: 'failed' });
    const c = this.ensureCounter(this.ingestionCounters, source);
    c.failures++;
  }

  // ==========================================================================
  // Notification KPIs
  // ==========================================================================

  recordNotificationAttempt(channel: string): void {
    this.collector.counter('kpi.notification.attempts_total', 1, { channel });
    this.ensureCounter(this.notificationCounters, channel);
  }

  recordNotificationDelivered(channel: string): void {
    this.collector.counter('kpi.notification.delivered_total', 1, { channel });
    const c = this.ensureCounter(this.notificationCounters, channel);
    c.successes++;
  }

  recordNotificationFailed(channel: string): void {
    this.collector.counter('kpi.notification.failed_total', 1, { channel });
    const c = this.ensureCounter(this.notificationCounters, channel);
    c.failures++;
  }

  recordNotificationSkipped(channel: string, reason: string): void {
    this.collector.counter('kpi.notification.skipped_total', 1, { channel, reason });
  }

  // ==========================================================================
  // Webhook KPIs
  // ==========================================================================

  recordWebhookProcessed(provider: string): void {
    this.collector.counter('kpi.webhook.processed_total', 1, { provider });
    const c = this.ensureCounter(this.webhookCounters, provider);
    c.successes++;
  }

  recordWebhookFailed(provider: string): void {
    this.collector.counter('kpi.webhook.failed_total', 1, { provider });
    const c = this.ensureCounter(this.webhookCounters, provider);
    c.failures++;
  }

  recordWebhookDuplicate(provider: string): void {
    this.collector.counter('kpi.webhook.duplicate_total', 1, { provider });
  }

  // ==========================================================================
  // Periodic Evaluation
  // ==========================================================================

  /**
   * Start periodic rate/throughput computation
   */
  start(intervalMs: number = 60000): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.evaluate();
    }, intervalMs);

    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }

    logger.info('Business KPI tracker started', { intervalMs });
  }

  /**
   * Stop periodic evaluation
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  private evaluate(): void {
    // Publishing rates
    for (const [platform, c] of this.publishCounters) {
      const total = c.successes + c.failures;
      if (total > 0) {
        this.collector.gauge('kpi.publishing.success_rate', c.successes / total, { platform });
      }
      // Throughput: successful publishes per minute over last evaluation window
      const now = Date.now();
      const oneMinuteAgo = now - 60000;
      const recentCount = c.timestamps.filter(t => t >= oneMinuteAgo).length;
      this.collector.gauge('kpi.publishing.throughput_per_minute', recentCount, { platform });
      // Trim old timestamps (keep last 10 minutes)
      const tenMinutesAgo = now - 600000;
      c.timestamps = c.timestamps.filter(t => t >= tenMinutesAgo);
    }

    // Ingestion rates
    for (const [source, c] of this.ingestionCounters) {
      const total = c.successes + c.failures;
      if (total > 0) {
        this.collector.gauge('kpi.ingestion.success_rate', c.successes / total, { source });
      }
    }

    // Notification rates
    for (const [channel, c] of this.notificationCounters) {
      const total = c.successes + c.failures;
      if (total > 0) {
        this.collector.gauge('kpi.notification.delivery_rate', c.successes / total, { channel });
      }
    }

    // Webhook rates
    for (const [provider, c] of this.webhookCounters) {
      const total = c.successes + c.failures;
      if (total > 0) {
        this.collector.gauge('kpi.webhook.success_rate', c.successes / total, { provider });
      }
    }
  }

  private ensureCounter(map: Map<string, WindowCounters>, key: string): WindowCounters {
    let c = map.get(key);
    if (!c) {
      c = { successes: 0, failures: 0, timestamps: [] };
      map.set(key, c);
    }
    return c;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: BusinessKpiTracker | null = null;

export function initBusinessKpis(collector?: MetricsCollector): BusinessKpiTracker {
  const c = collector ?? getMetricsCollector();
  instance = new BusinessKpiTracker(c);
  return instance;
}

export function getBusinessKpis(): BusinessKpiTracker {
  if (!instance) {
    throw new Error('BusinessKpiTracker not initialized. Call initBusinessKpis() first.');
  }
  return instance;
}
