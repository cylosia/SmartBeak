/**
 * SLO Tracker
 *
 * Implements the SloConfig / SloStatus types from types.ts with a working
 * tracker that computes error budgets and burn rates. Uses sliding window
 * counters for success/failure tracking and emits gauge metrics for
 * dashboards and alerting.
 *
 * Golden signals (latency, error rate, throughput, saturation) are defined
 * as SLO targets with configurable windows and alert thresholds.
 */

import { getLogger } from '@kernel/logger';

import { MetricsCollector, getMetricsCollector } from './metrics-collector';
import type { SloConfig, SloStatus } from './types';

const logger = getLogger('slo-tracker');

// ============================================================================
// Types
// ============================================================================

export interface SloTrackerConfig {
  metricsCollector?: MetricsCollector;
}

interface SloWindow {
  successes: number;
  failures: number;
  entries: { timestamp: number; success: boolean }[];
}

// ============================================================================
// Default SLO Definitions
// ============================================================================

export const defaultSloDefinitions: SloConfig[] = [
  // Golden signals — Latency
  {
    id: 'slo.api.latency.p99',
    name: 'API P99 Latency',
    metric: 'slo.api.latency.p99',
    target: 0.99, // 99% of requests under 500ms
    window: '30d',
    alertThreshold: 0.98,
  },
  {
    id: 'slo.db.latency.p99',
    name: 'DB Query P99 Latency',
    metric: 'slo.db.latency.p99',
    target: 0.99, // 99% of queries under 100ms
    window: '7d',
    alertThreshold: 0.98,
  },

  // Golden signals — Error rate
  {
    id: 'slo.api.availability',
    name: 'API Availability',
    metric: 'slo.api.availability',
    target: 0.999, // 99.9% availability
    window: '30d',
    alertThreshold: 0.995,
  },
  {
    id: 'slo.api.error_rate',
    name: 'API 5xx Error Rate',
    metric: 'slo.api.error_rate',
    target: 0.99, // <1% 5xx errors
    window: '30d',
    alertThreshold: 0.98,
  },

  // Business SLOs
  {
    id: 'slo.publishing.success_rate',
    name: 'Publishing Success Rate',
    metric: 'slo.publishing.success_rate',
    target: 0.95, // 95% success
    window: '7d',
    alertThreshold: 0.93,
  },
  {
    id: 'slo.notification.delivery_rate',
    name: 'Notification Delivery Rate',
    metric: 'slo.notification.delivery_rate',
    target: 0.98, // 98% delivered
    window: '7d',
    alertThreshold: 0.96,
  },
  {
    id: 'slo.webhook.processing_rate',
    name: 'Webhook Processing Rate',
    metric: 'slo.webhook.processing_rate',
    target: 0.995, // 99.5% processed
    window: '30d',
    alertThreshold: 0.99,
  },
];

// ============================================================================
// Golden Signal Saturation Thresholds
// ============================================================================

export const saturationThresholds = {
  memory: { warning: 0.80, critical: 0.90 },
  cpu: { warning: 0.85, critical: 0.95 },
  queueDepth: { warning: 500, critical: 1000 },
  connectionPool: { warning: 0.90, critical: 0.95 },
} as const;

// ============================================================================
// SLO Tracker
// ============================================================================

const WINDOW_MS: Record<string, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export class SloTracker {
  private readonly slos = new Map<string, SloConfig>();
  private readonly windows = new Map<string, SloWindow>();
  private readonly collector: MetricsCollector | null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SloTrackerConfig = {}) {
    this.collector = config.metricsCollector ?? null;
  }

  /**
   * Register an SLO definition
   */
  registerSlo(slo: SloConfig): void {
    this.slos.set(slo.id, slo);
    this.windows.set(slo.id, { successes: 0, failures: 0, entries: [] });
  }

  /**
   * Record a successful event against an SLO
   */
  recordSuccess(sloId: string): void {
    const window = this.windows.get(sloId);
    if (!window) return;
    window.successes++;
    window.entries.push({ timestamp: Date.now(), success: true });
  }

  /**
   * Record a failed event against an SLO
   */
  recordFailure(sloId: string): void {
    const window = this.windows.get(sloId);
    if (!window) return;
    window.failures++;
    window.entries.push({ timestamp: Date.now(), success: false });
  }

  /**
   * Get current status for a single SLO
   */
  getStatus(sloId: string): SloStatus | undefined {
    const slo = this.slos.get(sloId);
    if (!slo) return undefined;
    return this.computeStatus(slo);
  }

  /**
   * Get status for all registered SLOs
   */
  getAllStatuses(): SloStatus[] {
    const statuses: SloStatus[] = [];
    for (const slo of this.slos.values()) {
      statuses.push(this.computeStatus(slo));
    }
    return statuses;
  }

  /**
   * Get burn rate for an SLO over a lookback period
   * Burn rate = actual error rate / allowed error rate
   * A burn rate of 1.0 means we are consuming budget exactly on schedule.
   * A burn rate >1.0 means we are consuming budget faster than sustainable.
   */
  getBurnRate(sloId: string, lookbackMinutes: number = 60): number {
    const slo = this.slos.get(sloId);
    const window = this.windows.get(sloId);
    if (!slo || !window) return 0;

    const lookbackMs = lookbackMinutes * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;
    const recent = window.entries.filter(e => e.timestamp >= cutoff);

    const total = recent.length;
    if (total === 0) return 0;

    const failures = recent.filter(e => !e.success).length;
    const actualErrorRate = failures / total;
    const allowedErrorRate = 1 - slo.target;

    if (allowedErrorRate === 0) return actualErrorRate > 0 ? Infinity : 0;
    return actualErrorRate / allowedErrorRate;
  }

  /**
   * Start periodic SLO evaluation
   */
  start(intervalMs: number = 60000): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.evaluate();
    }, intervalMs);

    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }

    logger.info('SLO tracker started', { sloCount: this.slos.size, intervalMs });
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

  // ============================================================================
  // Internal
  // ============================================================================

  private evaluate(): void {
    const collector = this.collector ?? getCollectorSafe();
    if (!collector) return;

    for (const slo of this.slos.values()) {
      this.trimWindow(slo.id, slo.window);
      const status = this.computeStatus(slo);
      const burnRate = this.getBurnRate(slo.id);

      const labels = { slo_id: slo.id, slo_name: slo.name };
      collector.gauge('slo.budget_remaining', status.budgetRemaining, labels);
      collector.gauge('slo.burn_rate', burnRate, labels);
      collector.gauge('slo.current_value', status.current, labels);
      collector.gauge('slo.target', slo.target, labels);

      const statusValue = status.status === 'healthy' ? 0 : status.status === 'at_risk' ? 1 : 2;
      collector.gauge('slo.status', statusValue, labels);

      if (status.status === 'breached') {
        logger.warn(`SLO breached: ${slo.name}`, {
          current: status.current,
          target: slo.target,
          budgetRemaining: status.budgetRemaining,
        });
      }
    }
  }

  private computeStatus(slo: SloConfig): SloStatus {
    const window = this.windows.get(slo.id);
    if (!window) {
      return {
        sloId: slo.id,
        name: slo.name,
        target: slo.target,
        current: 1,
        budgetRemaining: 1,
        status: 'healthy',
      };
    }

    const total = window.successes + window.failures;
    const current = total === 0 ? 1 : window.successes / total;

    // Error budget: how much of the allowed error budget remains
    const allowedErrorRate = 1 - slo.target;
    const actualErrorRate = 1 - current;
    const budgetRemaining = allowedErrorRate === 0
      ? (actualErrorRate === 0 ? 1 : 0)
      : Math.max(0, 1 - (actualErrorRate / allowedErrorRate));

    let status: SloStatus['status'] = 'healthy';
    if (current < slo.alertThreshold) {
      status = 'breached';
    } else if (current < slo.target) {
      status = 'at_risk';
    }

    return {
      sloId: slo.id,
      name: slo.name,
      target: slo.target,
      current,
      budgetRemaining,
      status,
    };
  }

  private trimWindow(sloId: string, windowStr: string): void {
    const window = this.windows.get(sloId);
    if (!window) return;

    const windowMs = WINDOW_MS[windowStr] ?? WINDOW_MS['30d']!;
    const cutoff = Date.now() - windowMs;

    const before = window.entries.length;
    window.entries = window.entries.filter(e => e.timestamp >= cutoff);
    const removed = before - window.entries.length;

    if (removed > 0) {
      // Recalculate counts from entries
      window.successes = window.entries.filter(e => e.success).length;
      window.failures = window.entries.filter(e => !e.success).length;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SloTracker | null = null;

export function initSloTracker(config?: SloTrackerConfig): SloTracker {
  instance = new SloTracker(config);
  return instance;
}

export function getSloTracker(): SloTracker {
  if (!instance) {
    throw new Error('SloTracker not initialized. Call initSloTracker() first.');
  }
  return instance;
}

function getCollectorSafe(): MetricsCollector | null {
  try {
    return getMetricsCollector();
  } catch {
    return null;
  }
}
