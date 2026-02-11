import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

import { LRUCache } from '../utils/lruCache';

﻿import { EventEmitter } from 'events';


const logger = getLogger('CostTracker');

/**
* Cost Tracking & Budget Management
* Tracks API costs, enforces budgets, and provides spending insights
*/

export interface CostEntry {
  id?: string;
  orgId: string;
  service: string;
  operation: string;
  cost: number;
  currency: string;
  tokens?: number;
  requestId?: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

export interface BudgetAlert {
  orgId: string;
  period: 'daily' | 'monthly';
  budget: number;
  spent: number;
  remaining: number;
  percentageUsed: number;
}

export interface CostBreakdown {
  service: string;
  totalCost: number;
  percentage: number;
  trend: 'up' | 'down' | 'stable';
}

export class CostTracker extends EventEmitter {
  private readonly db: Pool;
  private buffer: CostEntry[] = [];
  private readonly flushIntervalMs: number = 30000; // 30 seconds
  private flushTimer?: NodeJS.Timeout;
  private readonly budgets = new LRUCache<string, { daily: number; monthly: number }>({ maxSize: 10000, ttlMs: 86400000 });

  constructor(db: Pool) {
  super();
  this.db = db;
  this.startFlushTimer();
  }

  /**
  * Start automatic flush timer
  */
  private startFlushTimer(): void {
  this.flushTimer = setInterval(() => {
    this.flush();
  }, this.flushIntervalMs).unref();
  }

  /**
  * Stop the tracker
  */
  stop(): void {
  if (this.flushTimer) {
    clearInterval(this.flushTimer);
  }
  this.flush();
  }

  /**
  * Set budget for an organization
  * @param orgId - Organization ID
  * @param daily - Daily budget limit in dollars
  * @param monthly - Monthly budget limit in dollars
  */
  setBudget(orgId: string, daily: number, monthly: number): void {
  this.budgets.set(orgId, { daily, monthly });
  }

  /**
  * Track a cost entry
  * @param entry - Cost entry to track
  * @throws Error if daily budget is exceeded
  */
  async track(entry: CostEntry): Promise<void> {
  // Validate budget before tracking
  const budget = this.budgets.get(entry["orgId"]);
  if (budget) {
    const todayCost = await this.getTodayCost(entry["orgId"]);
    if (todayCost + entry.cost > budget.daily) {
    this.emit('budgetExceeded', {
    orgId: entry["orgId"],
    budget: budget.daily,
    attempted: todayCost + entry.cost,
    });
    throw new Error(`Daily budget exceeded for org ${entry["orgId"]}`);
    }
  }

  this.buffer.push(entry);

  // Flush if buffer is large
  if (this.buffer.length >= 100) {
    await this.flush();
  }

  // Emit cost event
  this.emit('cost', entry);
  }

  /**
  * Track OpenAI API cost
  */
  async trackOpenAI(
  orgId: string,
  model: string,
  tokens: { prompt: number; completion: number },
  requestId?: string
  ): Promise<void> {
  // Pricing per 1K tokens (as of 2024)
  const pricing: Record<string, { input: number; output: number }> = {
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
    'dall-e-3': { input: 0, output: 0.08 }, // per image, not token-based
    'dall-e-2': { input: 0, output: 0.02 },
  };

  const price = pricing[model] || pricing['gpt-3.5-turbo'];
  const inputCost = (tokens.prompt / 1000) * (price?.input ?? 0);
  const outputCost = (tokens.completion / 1000) * (price?.output ?? 0);
  const totalCost = inputCost + outputCost;

  await this.track({
    orgId,
    service: 'openai',
    operation: model,
    cost: totalCost,
    currency: 'USD',
    tokens: tokens.prompt + tokens.completion,
    timestamp: new Date(),
  } as CostEntry);
  }

  /**
  * Track Stability AI cost
  */
  async trackStability(
  orgId: string,
  model: string,
  steps: number,
  requestId?: string
  ): Promise<void> {
  // Pricing per image
  const pricing: Record<string, number> = {
    'stable-diffusion-xl-1024-v1-0': 0.008,
    'stable-diffusion-v1-6': 0.002,
    'stable-image-core': 0.03,
    'stable-image-ultra': 0.08,
  };

  const cost = pricing[model] || 0.008;

  await this.track({
    orgId,
    service: 'stability',
    operation: model,
    cost,
    currency: 'USD',
    metadata: { steps },
    timestamp: new Date(),
  } as CostEntry);
  }

  /**
  * Track keyword research API cost
  */
  async trackKeywordAPI(
  orgId: string,
  provider: 'ahrefs' | 'gsc' | 'paa',
  requests: number,
  requestId?: string
  ): Promise<void> {
  // Approximate costs
  const pricing: Record<string, number> = {
    ahrefs: 0.01, // per request
    gsc: 0, // free
    paa: 0.005, // per request (SerpApi/DataForSEO)
  };

  const cost = pricing[provider]! * requests;

  await this.track({
    orgId,
    service: provider,
    operation: 'keyword_fetch',
    cost,
    currency: 'USD',
    metadata: { requests },
    timestamp: new Date(),
  } as CostEntry);
  }

  /**
  * Flush buffered costs to database
  */
  private async flush(): Promise<void> {
  if (this.buffer.length === 0) return;

  const entries = this.buffer.splice(0, this.buffer.length);

  try {
    await this.db.query(
    `INSERT INTO cost_tracking (
    org_id, service, operation, cost, currency, tokens, request_id, metadata, timestamp, date
    )
    SELECT * FROM UNNEST(
    $1::text[], $2::text[], $3::text[], $4::numeric[], $5::text[],
    $6::int[], $7::text[], $8::jsonb[], $9::timestamp[], $10::date[]
    )`,
    [
    entries.map(e => e["orgId"]),
    entries.map(e => e["service"]),
    entries.map(e => e.operation),
    entries.map(e => e.cost),
    entries.map(e => e.currency),
    entries.map(e => e.tokens || 0),
    entries.map(e => e.requestId || ''),
    entries.map(e => JSON.stringify(e["metadata"] || {})),
    entries.map(e => e.timestamp),
    entries.map(e => e.timestamp.toISOString().split('T')[0]),
    ]
    );
  } catch (error) {
    logger["error"]('Flush failed', error instanceof Error ? error : new Error(String(error)));
    // Re-add entries to buffer for retry
    this.buffer.unshift(...entries);
  }
  }

  /**
  * Get today's cost for an org
  */
  async getTodayCost(orgId: string): Promise<number> {
  const { rows } = await this.db.query(
    `SELECT COALESCE(SUM(cost), 0) as total
    FROM cost_tracking
    WHERE org_id = $1 AND date = CURRENT_DATE`,
    [orgId]
  );

  return parseFloat(rows[0]?.total || 0);
  }

  /**
  * Get cost summary for a date range
  */
  async getCostSummary(
  orgId: string,
  startDate: Date,
  endDate: Date
  ): Promise<{
  totalCost: number;
  byService: CostBreakdown[];
  byDay: Array<{ date: string; cost: number }>;
  }> {
  // Total cost
  const { rows: totalRows } = await this.db.query(
    `SELECT COALESCE(SUM(cost), 0) as total
    FROM cost_tracking
    WHERE org_id = $1
    AND date BETWEEN $2 AND $3`,
    [orgId, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
  );

  const totalCost = parseFloat(totalRows[0]?.total || 0);

  // By service
  const { rows: serviceRows } = await this.db.query(
    `SELECT service, SUM(cost) as cost
    FROM cost_tracking
    WHERE org_id = $1
    AND date BETWEEN $2 AND $3
    GROUP BY service
    ORDER BY cost DESC`,
    [orgId, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
  );

  // Get previous period for trend
  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const prevStart = new Date(startDate);
  prevStart.setDate(prevStart.getDate() - days);
  const prevEnd = new Date(startDate);
  prevEnd.setDate(prevEnd.getDate() - 1);

  const { rows: prevRows } = await this.db.query(
    `SELECT service, SUM(cost) as cost
    FROM cost_tracking
    WHERE org_id = $1
    AND date BETWEEN $2 AND $3
    GROUP BY service`,
    [orgId, prevStart.toISOString().split('T')[0], prevEnd.toISOString().split('T')[0]]
  );

  const prevByService = new Map(prevRows.map(r => [r["service"], parseFloat(r.cost)]));

  const byService: CostBreakdown[] = serviceRows.map(r => {
    const currentCost = parseFloat(r.cost);
    const prevCost = prevByService.get(r["service"]) || 0;
    const trend: 'up' | 'down' | 'stable' =
    currentCost > prevCost * 1.1 ? 'up' :
    currentCost < prevCost * 0.9 ? 'down' : 'stable';

    return {
    service: r["service"],
    totalCost: currentCost,
    percentage: totalCost > 0 ? (currentCost / totalCost) * 100 : 0,
    trend,
    };
  });

  // By day
  const { rows: dayRows } = await this.db.query(
    `SELECT date, SUM(cost) as cost
    FROM cost_tracking
    WHERE org_id = $1
    AND date BETWEEN $2 AND $3
    GROUP BY date
    ORDER BY date`,
    [orgId, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
  );

  return {
    totalCost,
    byService,
    byDay: dayRows.map(r => ({ date: r.date, cost: parseFloat(r.cost) })),
  };
  }

  /**
  * Get budget status for an org
  */
  async getBudgetStatus(orgId: string): Promise<BudgetAlert> {
  const budget = this.budgets.get(orgId);
  if (!budget) {
    throw new Error(`No budget set for org ${orgId}`);
  }

  const todayCost = await this.getTodayCost(orgId);

  // Get monthly cost
  const { rows } = await this.db.query(
    `SELECT COALESCE(SUM(cost), 0) as total
    FROM cost_tracking
    WHERE org_id = $1
    AND date >= DATE_TRUNC('month', CURRENT_DATE)`,
    [orgId]
  );

  const monthlyCost = parseFloat(rows[0]?.total || 0);

  return {
    orgId,
    period: 'daily',
    budget: budget.daily,
    spent: todayCost,
    remaining: Math.max(0, budget.daily - todayCost),
    percentageUsed: budget.daily > 0 ? (todayCost / budget.daily) * 100 : 0,
  };
  }

  /**
  * Get cost forecast
  */
  async getForecast(orgId: string, days: number = 30): Promise<{
  projectedCost: number;
  confidence: 'high' | 'medium' | 'low';
  }> {
  // Get average daily cost over last 30 days
  const { rows } = await this.db.query(
    `SELECT AVG(daily_cost) as avg_cost
    FROM (
    SELECT date, SUM(cost) as daily_cost
    FROM cost_tracking
    WHERE org_id = $1
    AND date >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY date
    ) daily`,
    [orgId]
  );

  const avgDailyCost = parseFloat(rows[0]?.avg_cost || 0);
  const projectedCost = avgDailyCost * days;

  // Calculate confidence based on variance
  const { rows: varianceRows } = await this.db.query(
    `SELECT STDDEV(daily_cost) / NULLIF(AVG(daily_cost), 0) as cv
    FROM (
    SELECT date, SUM(cost) as daily_cost
    FROM cost_tracking
    WHERE org_id = $1
    AND date >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY date
    ) daily`,
    [orgId]
  );

  const cv = parseFloat(varianceRows[0]?.cv || 0);
  const confidence: 'high' | 'medium' | 'low' =
    cv < 0.3 ? 'high' : cv < 0.6 ? 'medium' : 'low';

  return { projectedCost, confidence };
  }

  /**
  * Check if operation is within budget
  */
  async checkBudget(orgId: string, estimatedCost: number): Promise<{
  allowed: boolean;
  reason?: string;
  }> {
  const budget = this.budgets.get(orgId);
  if (!budget) {
    return { allowed: true }; // No budget = no limit
  }

  const todayCost = await this.getTodayCost(orgId);

  if (todayCost + estimatedCost > budget.daily) {
    return {
    allowed: false,
    reason: `Daily budget exceeded. Spent: $${todayCost.toFixed(2)}, Budget: $${budget.daily}`,
    };
  }

  // Check if this would exceed 80% of daily budget
  if (todayCost + estimatedCost > budget.daily * 0.8) {
    this.emit('budgetWarning', {
    current: todayCost,
    projected: todayCost + estimatedCost,
    budget: budget.daily,
    });
  }

  return { allowed: true };
  }
}
