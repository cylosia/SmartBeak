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

// P1-FIX: Whitelist metric label values to prevent Prometheus cardinality explosion.
// User-controlled strings used as label values (e.g. error messages as `reason`,
// arbitrary platform names) create a unique time-series per label combination.
// At scale this exhausts monitoring memory and makes range queries unusably slow.
// Any value not in the whitelist is normalised to 'other'.
const KNOWN_PLATFORMS = new Set(['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok', 'youtube', 'pinterest', 'web']);
const KNOWN_SOURCES = new Set(['rss', 'api', 'manual', 'webhook', 'scheduled', 'bulk']);
const KNOWN_CHANNELS = new Set(['email', 'push', 'sms', 'slack', 'webhook', 'in_app']);
const KNOWN_PROVIDERS = new Set(['stripe', 'paddle', 'internal', 'webhook']);
const KNOWN_FAILURE_REASONS = new Set([
  'timeout', 'auth_error', 'rate_limited', 'not_found',
  'server_error', 'validation_error', 'quota_exceeded', 'network_error',
]);

function safeLabel(value: string, whitelist: Set<string>): string {
  return whitelist.has(value) ? value : 'other';
}

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
    const p = safeLabel(platform, KNOWN_PLATFORMS);
    this.collector.counter('kpi.publishing.attempts_total', 1, { platform: p });
    this.ensureCounter(this.publishCounters, p);
  }

  recordPublishSuccess(platform: string): void {
    const p = safeLabel(platform, KNOWN_PLATFORMS);
    this.collector.counter('kpi.publishing.success_total', 1, { platform: p });
    const c = this.ensureCounter(this.publishCounters, p);
    c.successes++;
    c.timestamps.push(Date.now());
    // Eagerly trim to prevent unbounded growth between evaluate() cycles.
    // Without this, high publish rates cause the array to grow to millions
    // of entries before the per-minute evaluate() trim runs.
    if (c.timestamps.length > 10_000) {
      const tenMinutesAgo = Date.now() - 10 * 60 * 1_000;
      c.timestamps = c.timestamps.filter(t => t >= tenMinutesAgo);
    }
  }

  recordPublishFailure(platform: string, reason: string): void {
    const p = safeLabel(platform, KNOWN_PLATFORMS);
    const r = safeLabel(reason, KNOWN_FAILURE_REASONS);
    this.collector.counter('kpi.publishing.failures_total', 1, { platform: p, reason: r });
    const c = this.ensureCounter(this.publishCounters, p);
    c.failures++;
  }

  // ==========================================================================
  // Ingestion KPIs
  // ==========================================================================

  recordIngestionAttempt(source: string): void {
    const s = safeLabel(source, KNOWN_SOURCES);
    this.collector.counter('kpi.ingestion.attempts_total', 1, { source: s });
    this.ensureCounter(this.ingestionCounters, s);
  }

  recordIngestionSuccess(source: string, count: number): void {
    const s = safeLabel(source, KNOWN_SOURCES);
    this.collector.counter('kpi.ingestion.success_total', 1, { source: s });
    this.collector.counter('kpi.ingestion.items_total', count, { source: s, status: 'success' });
    const c = this.ensureCounter(this.ingestionCounters, s);
    c.successes++;
  }

  recordIngestionFailure(source: string, count: number): void {
    const s = safeLabel(source, KNOWN_SOURCES);
    this.collector.counter('kpi.ingestion.failures_total', 1, { source: s });
    this.collector.counter('kpi.ingestion.items_total', count, { source: s, status: 'failed' });
    const c = this.ensureCounter(this.ingestionCounters, s);
    c.failures++;
  }

  // ==========================================================================
  // Notification KPIs
  // ==========================================================================

  recordNotificationAttempt(channel: string): void {
    const ch = safeLabel(channel, KNOWN_CHANNELS);
    this.collector.counter('kpi.notification.attempts_total', 1, { channel: ch });
    this.ensureCounter(this.notificationCounters, ch);
  }

  recordNotificationDelivered(channel: string): void {
    const ch = safeLabel(channel, KNOWN_CHANNELS);
    this.collector.counter('kpi.notification.delivered_total', 1, { channel: ch });
    const c = this.ensureCounter(this.notificationCounters, ch);
    c.successes++;
  }

  recordNotificationFailed(channel: string): void {
    const ch = safeLabel(channel, KNOWN_CHANNELS);
    this.collector.counter('kpi.notification.failed_total', 1, { channel: ch });
    const c = this.ensureCounter(this.notificationCounters, ch);
    c.failures++;
  }

  recordNotificationSkipped(channel: string, reason: string): void {
    const ch = safeLabel(channel, KNOWN_CHANNELS);
    const r = safeLabel(reason, KNOWN_FAILURE_REASONS);
    this.collector.counter('kpi.notification.skipped_total', 1, { channel: ch, reason: r });
  }

  // ==========================================================================
  // Webhook KPIs
  // ==========================================================================

  recordWebhookProcessed(provider: string): void {
    const pv = safeLabel(provider, KNOWN_PROVIDERS);
    this.collector.counter('kpi.webhook.processed_total', 1, { provider: pv });
    const c = this.ensureCounter(this.webhookCounters, pv);
    c.successes++;
  }

  recordWebhookFailed(provider: string): void {
    const pv = safeLabel(provider, KNOWN_PROVIDERS);
    this.collector.counter('kpi.webhook.failed_total', 1, { provider: pv });
    const c = this.ensureCounter(this.webhookCounters, pv);
    c.failures++;
  }

  recordWebhookDuplicate(provider: string): void {
    const pv = safeLabel(provider, KNOWN_PROVIDERS);
    this.collector.counter('kpi.webhook.duplicate_total', 1, { provider: pv });
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
  instance?.stop();
  instance = new BusinessKpiTracker(c);
  return instance;
}

export function getBusinessKpis(): BusinessKpiTracker {
  if (!instance) {
    throw new Error('BusinessKpiTracker not initialized. Call initBusinessKpis() first.');
  }
  return instance;
}
