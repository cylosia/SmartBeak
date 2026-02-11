import { EventEmitter } from 'events';
import { Pool } from 'pg';

﻿import crypto from 'crypto';

/**
* ML-Based Predictions & Anomaly Detection
* Predicts trends and detects anomalies in metrics
*/

export interface TrendPrediction {
  metric: string;
  currentValue: number;
  predictedValue: number;
  change: number;
  confidence: number;
  timeframe: string;
}

/** Context data for anomaly detection */
export interface AnomalyContext {
  mean: number;
  stdDev: number;
  domainId: string;
  [key: string]: unknown;
}

export interface Anomaly {
  id: string;
  metric: string;
  value: number;
  expectedRange: [number, number];
  severity: 'low' | 'medium' | 'high';
  timestamp: Date;
  context: AnomalyContext;
}

export interface ContentDecayPrediction {
  contentId: string;
  title: string;
  currentTraffic: number;
  predictedTraffic30d: number;
  decayRisk: 'low' | 'medium' | 'high';
  recommendedAction: string;
}

export interface KeywordOpportunity {
  keyword: string;
  searchVolume: number;
  currentPosition?: number;
  difficulty: number;
  opportunityScore: number;
  estimatedTraffic: number;
  competitionLevel: 'low' | 'medium' | 'high';
}

export class MLPredictionEngine extends EventEmitter {
  private db: Pool;

  constructor(db: Pool) {
  super();
  this.db = db;
  }

  /**
  * Predict keyword ranking trajectory
  */
  async predictKeywordTrend(
  domainId: string,
  keyword: string,
  days: number = 30
  ): Promise<TrendPrediction> {
  // Get historical ranking data
  const { rows } = await this.db.query(
    `SELECT
    AVG(position) as avg_position,
    SUM(clicks) as total_clicks
    FROM keyword_metrics
    WHERE domain_id = $1 AND keyword = $2
    AND date >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY date
    ORDER BY date`,
    [domainId, keyword]
  );

  if (rows.length < 7) {
    return {
    metric: 'keyword_position',
    currentValue: 0,
    predictedValue: 0,
    change: 0,
    confidence: 0,
    timeframe: `${days}d`,
    };
  }

  // Simple linear regression
  const positions = rows.map(r => parseFloat(r.avg_position));
  const n = positions.length;

  // Calculate trend using simple moving average slope
  const windowSize = Math.min(7, n);
  const recentAvg = positions.slice(-windowSize).reduce((a, b) => a + b, 0) / windowSize;
  const olderAvg = positions.slice(0, windowSize).reduce((a, b) => a + b, 0) / windowSize;

  // Trend per day
  // P0-FIX: Add zero check to prevent division by zero
  const denominator = n - windowSize;
  if (denominator <= 0) {
    return {
    metric: 'keyword_position',
    currentValue: positions[positions.length - 1] || 0,
    predictedValue: positions[positions.length - 1] || 0,
    change: 0,
    confidence: 0,
    timeframe: `${days}d`,
    };
  }
  const dailyChange = (recentAvg - olderAvg) / denominator;

  // Predict position
  const currentPosition = positions[positions.length - 1] || 0;
  const predictedPosition = Math.max(1, currentPosition + dailyChange * days);

  // Calculate confidence based on data consistency
  const variance = this.calculateVariance(positions);
  const confidence = Math.max(0, 1 - variance / 100);

  return {
    metric: 'keyword_position',
    currentValue: currentPosition || 0,
    predictedValue: predictedPosition || 0,
    change: (predictedPosition || 0) - (currentPosition || 0),
    confidence,
    timeframe: `${days}d`,
  };
  }

  /**
  * Detect anomalies in metrics
  */
  async detectAnomalies(
  domainId: string,
  metric: 'traffic' | 'rankings' | 'engagement',
  sensitivity: number = 2 // Standard deviations
  ): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];

  // Get metric data
  const data = await this.getMetricData(domainId, metric);

  if (data.length < 14) {
    return anomalies; // Need at least 2 weeks of data
  }

  // Calculate statistics
  const values = data.map(d => d.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stdDev = Math.sqrt(this.calculateVariance(values));

  const lowerBound = mean - sensitivity * stdDev;
  const upperBound = mean + sensitivity * stdDev;

  // Find anomalies
  for (const point of data) {
    if (point.value < lowerBound || point.value > upperBound) {
    const severity: 'low' | 'medium' | 'high' =
    Math.abs(point.value - mean) > 3 * stdDev ? 'high' :
    Math.abs(point.value - mean) > 2 * stdDev ? 'medium' : 'low';

    anomalies.push({
    id: `anomaly_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
    metric: 'content_decay',
    value: point.value,
    expectedRange: [lowerBound, upperBound],
    severity,
    timestamp: point.date,
    context: { mean, stdDev, domainId },
    } as Anomaly);
    }
  }

  // Emit anomaly event if found
  if (anomalies.length > 0) {
    this.emit('anomalies', anomalies);
  }

  return anomalies;
  }

  /**
  * Predict content decay
  */
  async predictContentDecay(domainId: string): Promise<ContentDecayPrediction[]> {
  const { rows } = await this.db.query(
    `WITH content_stats AS (
    c.id as content_id,
    c.title,
    AVG(cp.page_views) as avg_views,
    STDDEV(cp.page_views) as view_stddev,
    CORR(
    EXTRACT(EPOCH FROM (cp.timestamp - NOW())) / 86400,
    cp.page_views
    ) as trend_correlation
    FROM content_items c
    LEFT JOIN content_performance cp ON c.id = cp.content_id
    WHERE c.domain_id = $1
    AND c.status = 'published'
    AND cp.timestamp >= NOW() - INTERVAL '90 days'
    GROUP BY c.id, c.title
    HAVING COUNT(cp.id) >= 30
    )
    SELECT * FROM content_stats
    WHERE avg_views > 0`,
    [domainId]
  );

  return rows.map(row => {
    const correlation = parseFloat(row.trend_correlation || 0);
    const avgViews = parseFloat(row.avg_views);
    const stdDev = parseFloat(row.view_stddev || 0);

    // Predict 30-day traffic
    const trendFactor = correlation * 30 * (stdDev / avgViews);
    const predictedTraffic = Math.max(0, avgViews * 30 * (1 + trendFactor));

    // Determine decay risk
    const decayRisk: 'low' | 'medium' | 'high' =
    correlation < -0.5 ? 'high' :
    correlation < -0.2 ? 'medium' : 'low';

    // Recommend action
    let recommendedAction = 'Continue monitoring';
    if (decayRisk === 'high') {
    recommendedAction = 'Refresh content, update keywords, add new sections';
    } else if (decayRisk === 'medium') {
    recommendedAction = 'Optimize meta description, improve internal linking';
    }

    return {
    contentId: row.content_id,
    title: row.title,
    currentTraffic: Math.round(avgViews * 30),
    predictedTraffic30d: Math.round(predictedTraffic),
    decayRisk,
    recommendedAction,
    } as ContentDecayPrediction;
  });
  }

  /**
  * Find keyword opportunities
  */
  async findKeywordOpportunities(
  domainId: string,
  limit: number = 20
  ): Promise<KeywordOpportunity[]> {
  // Get current rankings
  const { rows: currentRanks } = await this.db.query(
    `SELECT keyword, AVG(position) as avg_position
    FROM keyword_metrics
    WHERE domain_id = $1
    AND source = 'gsc'
    AND timestamp >= NOW() - INTERVAL '30 days'
    GROUP BY keyword`,
    [domainId]
  );

  const rankedKeywords = new Map(
    currentRanks.map(r => [r.keyword, parseFloat(r.avg_position)])
  );

  // Get high-volume keywords not ranking well
  const { rows: opportunities } = await this.db.query(
    `WITH competitor_keywords AS (
    AVG(volume) as avg_volume,
    AVG(difficulty) as avg_difficulty,
    COUNT(DISTINCT domain_id) as competitor_count
    FROM keyword_metrics
    WHERE source = 'ahrefs'
    AND volume > 100
    AND difficulty < 50
    AND timestamp >= NOW() - INTERVAL '30 days'
    GROUP BY keyword
    )
    SELECT * FROM competitor_keywords
    WHERE competitor_count < 10  -- Low competition
    ORDER BY avg_volume DESC
    LIMIT $2`,
    [domainId, limit * 2]
  );

  return opportunities
    .filter(o => !rankedKeywords.has(o.keyword) || rankedKeywords.get(o.keyword)! > 20)
    .slice(0, limit)
    .map(o => {
    const volume = parseInt(o.avg_volume);
    const difficulty = parseInt(o.avg_difficulty);
    const position = rankedKeywords.get(o.keyword);

    // Calculate opportunity score
    // Higher volume, lower difficulty = better opportunity
    const opportunityScore = (volume / 1000) * (1 - difficulty / 100) * 100;

    // Estimate traffic if ranking #5
    const estimatedTraffic = volume * 0.05; // ~5% CTR for position 5

    return {
    keyword: o.keyword,
    searchVolume: volume,
    currentPosition: position ?? undefined,
    opportunityScore: Math.round(opportunityScore),
    estimatedTraffic: Math.round(estimatedTraffic),
    competitionLevel: o.competitor_count < 5 ? 'low' : o.competitor_count < 15 ? 'medium' : 'high',
    } as KeywordOpportunity;
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
  }

  /**
  * Predict optimal publishing time
  */
  async predictOptimalPublishingTime(
  domainId: string,
  platform: string
  ): Promise<{
  bestDay: string;
  bestHour: number;
  expectedEngagement: number;
  }> {
  const { rows } = await this.db.query(
    `SELECT
    EXTRACT(DOW FROM timestamp) as day_of_week,
    EXTRACT(HOUR FROM timestamp) as hour,
    AVG(engagement_rate) as avg_engagement
    FROM social_metrics
    WHERE content_id IN (
    SELECT id FROM content_items WHERE domain_id = $1
    )
    AND platform = $2
    AND timestamp >= NOW() - INTERVAL '90 days'
    GROUP BY day_of_week, hour
    ORDER BY avg_engagement DESC
    LIMIT 1`,
    [domainId, platform]
  );

  if (rows.length === 0) {
    return { bestDay: 'Tuesday', bestHour: 10, expectedEngagement: 0.05 };
  }

  const row = rows[0];
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayIndex = Math.floor(row.day_of_week) || 0;

  return {
    bestDay: days[dayIndex] ?? 'Tuesday',
    bestHour: Math.floor(row.hour) || 10,
    expectedEngagement: parseFloat(row.avg_engagement) || 0.05,
  };
  }

  /**
  * Get metric data for analysis
  */
  private async getMetricData(
  domainId: string,
  metric: string
  ): Promise<Array<{ date: Date; value: number }>> {
  let query = '';

  switch (metric) {
    case 'traffic':
    query = `
    SELECT date, SUM(page_views) as value
    FROM content_performance
    WHERE domain_id = $1
    AND date >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY date
    ORDER BY date
    `;
    break;
    case 'rankings':
    query = `
    SELECT date(timestamp) as date, AVG(position) as value
    FROM keyword_metrics
    WHERE domain_id = $1
    AND timestamp >= NOW() - INTERVAL '90 days'
    GROUP BY date(timestamp)
    ORDER BY date
    `;
    break;
    case 'engagement':
    query = `
    SELECT date(timestamp) as date, AVG(engagement_rate) as value
    FROM social_metrics
    WHERE content_id IN (
    SELECT id FROM content_items WHERE domain_id = $1
    )
    AND timestamp >= NOW() - INTERVAL '90 days'
    GROUP BY date(timestamp)
    ORDER BY date
    `;
    break;
  }

  const { rows } = await this.db.query(query, [domainId]);
  return rows.map(r => ({ date: r.date, value: parseFloat(r.value || 0) }));
  }

  /**
  * Calculate variance
  */
  private calculateVariance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
  * Calculate seasonality for a metric
  */
  async calculateSeasonality(
  domainId: string,
  metric: string
  ): Promise<{
  dayOfWeekPattern: number[];
  monthlyPattern: number[];
  }> {
  // Day of week pattern
  const { rows: dowRows } = await this.db.query(
    `SELECT
    EXTRACT(DOW FROM date) as dow,
    AVG(page_views) as avg_views
    FROM content_performance
    WHERE domain_id = $1
    AND date >= CURRENT_DATE - INTERVAL '365 days'
    GROUP BY EXTRACT(DOW FROM date)
    ORDER BY dow`,
    [domainId]
  );

  // Monthly pattern
  const { rows: monthRows } = await this.db.query(
    `SELECT
    EXTRACT(MONTH FROM date) as month,
    AVG(page_views) as avg_views
    FROM content_performance
    WHERE domain_id = $1
    AND date >= CURRENT_DATE - INTERVAL '365 days'
    GROUP BY EXTRACT(MONTH FROM date)
    ORDER BY month`,
    [domainId]
  );

  const baseline = dowRows.reduce((sum, r) => sum + parseFloat(r.avg_views), 0) / 7;

  return {
    dayOfWeekPattern: dowRows.map(r => parseFloat(r.avg_views) / baseline),
    monthlyPattern: monthRows.map(r => parseFloat(r.avg_views) / baseline),
  };
  }
}
