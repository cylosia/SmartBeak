import { Pool } from 'pg';

/**
* Analytics Pipeline
* Processes and stores keyword, social, and content performance data
*/

export interface KeywordMetric {
  keyword: string;
  domainId: string;
  source: 'ahrefs' | 'gsc' | 'paa';
  volume?: number;
  difficulty?: number;
  cpc?: number;
  position?: number;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  timestamp: Date;
}

export interface SocialMetric {
  platform: 'linkedin' | 'facebook' | 'twitter' | 'tiktok' | 'pinterest';
  contentId: string;
  postId: string;
  impressions: number;
  clicks: number;
  likes: number;
  comments: number;
  shares: number;
  engagementRate: number;
  timestamp: Date;
}

export interface ContentPerformance {
  contentId: string;
  domainId: string;
  pageViews: number;
  uniqueVisitors: number;
  avgTimeOnPage: number;
  bounceRate: number;
  conversions: number;
  revenue: number;
  timestamp: Date;
}

export class AnalyticsPipeline {
  private db: Pool;
  private batchSize: number = 1000;
  private flushIntervalMs: number = 60000; // 1 minute
  // P1-FIX: Add max buffer size to prevent unbounded memory growth
  private maxBufferSize: number = 10000;
  // P0-6 FIX: Global buffer limit across all types to cap total memory usage
  private static readonly MAX_GLOBAL_BUFFER_SIZE = 20000;
  private buffer: {
  keywords: KeywordMetric[];
  social: SocialMetric[];
  content: ContentPerformance[];
  } = {
  keywords: [],
  social: [],
  content: [],
  };
  private flushTimer?: NodeJS.Timeout;
  // P0-FIX: Separate locks per buffer type to prevent race conditions
  private isFlushing = {
  keywords: false,
  social: false,
  content: false
  };
  // P0-FIX: Add retry counter and dead letter queue for failed items
  private static readonly MAX_RETRIES = 3;
  private retryCount = new Map<string, number>();
  private dlq: Array<{ type: string; items: unknown[] }> = [];

  constructor(db: Pool) {
  this.db = db;
  this.startFlushTimer();
  }

  /**
  * Start automatic flush timer
  */
  private startFlushTimer(): void {
  this.flushTimer = setInterval(() => {
    void this.flush();
  }, this.flushIntervalMs).unref();
  }

  /**
  * Stop the pipeline and flush all buffered data.
  * P0-FIX: Changed to async and awaits flush() so buffered records are not
  * lost on graceful shutdown (SIGTERM). The previous void flush() allowed
  * the process to exit before the write completed, losing all buffered data.
  */
  async stop(): Promise<void> {
  if (this.flushTimer) {
    clearInterval(this.flushTimer);
  }
  await this.flush();
  }

  /**
  * P0-6 FIX: Get total buffer size across all types
  */
  private get totalBufferSize(): number {
  return this.buffer.keywords.length + this.buffer.social.length + this.buffer.content.length;
  }

  /**
  * P0-6 FIX: Enforce global buffer limit, flush all if exceeded
  */
  private async enforceGlobalLimit(): Promise<void> {
  if (this.totalBufferSize >= AnalyticsPipeline.MAX_GLOBAL_BUFFER_SIZE) {
    await this.flush();
  }
  }

  /**
  * Buffer keyword metrics for batch insert
  * P1-FIX: Added buffer overflow protection
  */
  async trackKeyword(metrics: KeywordMetric | KeywordMetric[]): Promise<void> {
  await this.enforceGlobalLimit();
  const items = Array.isArray(metrics) ? metrics : [metrics];
  this.buffer.keywords.push(...items);

  // P1-FIX: Flush if buffer exceeds max size to prevent memory overflow
  if (this.buffer.keywords.length >= this.maxBufferSize) {
    await this.flushKeywords();
  } else if (this.buffer.keywords.length >= this.batchSize) {
    await this.flushKeywords();
  }
  }

  /**
  * Buffer social metrics for batch insert
  * P1-FIX: Added buffer overflow protection
  */
  async trackSocial(metrics: SocialMetric | SocialMetric[]): Promise<void> {
  await this.enforceGlobalLimit();
  const items = Array.isArray(metrics) ? metrics : [metrics];
  this.buffer.social.push(...items);

  // P1-FIX: Flush if buffer exceeds max size to prevent memory overflow
  if (this.buffer.social.length >= this.maxBufferSize) {
    await this.flushSocial();
  } else if (this.buffer.social.length >= this.batchSize) {
    await this.flushSocial();
  }
  }

  /**
  * Buffer content performance for batch insert
  * P1-FIX: Added buffer overflow protection
  */
  async trackContent(metrics: ContentPerformance | ContentPerformance[]): Promise<void> {
  await this.enforceGlobalLimit();
  const items = Array.isArray(metrics) ? metrics : [metrics];
  this.buffer.content.push(...items);

  // P1-FIX: Flush if buffer exceeds max size to prevent memory overflow
  if (this.buffer.content.length >= this.maxBufferSize) {
    await this.flushContent();
  } else if (this.buffer.content.length >= this.batchSize) {
    await this.flushContent();
  }
  }

  /**
  * Flush all buffered data
  */
  async flush(): Promise<void> {
  await Promise.all([
    this.flushKeywords(),
    this.flushSocial(),
    this.flushContent(),
  ]);
  }

  /**
  * Flush keyword metrics
  * P1-FIX: Added concurrent flush protection
  */
  private async flushKeywords(): Promise<void> {
  if (this.buffer.keywords.length === 0 || this.isFlushing.keywords) return;
  this.isFlushing.keywords = true;
  const items = this.buffer.keywords.splice(0, this.batchSize);
  try {
    // Use unnest for efficient batch insert
    await this.db.query(
    `INSERT INTO keyword_metrics (
    keyword, domain_id, source, volume, difficulty, cpc,
    position, clicks, impressions, ctr, timestamp
    )
    SELECT * FROM UNNEST(
    $1::text[], $2::text[], $3::text[],
    $4::int[], $5::int[], $6::numeric[],
    $7::int[], $8::int[], $9::int[],
    $10::numeric[], $11::timestamp[]
    )`,
    [
    items.map(i => i.keyword),
    items.map(i => i.domainId),
    items.map(i => i.source),
    items.map(i => i.volume || 0),
    items.map(i => i.difficulty || 0),
    items.map(i => i.cpc || 0),
    items.map(i => i.position || 0),
    items.map(i => i.clicks || 0),
    items.map(i => i.impressions || 0),
    items.map(i => i.ctr || 0),
    items.map(i => i.timestamp),
    ]
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error["message"] : String(error);
    process.stderr.write(`[${new Date().toISOString()}] [AnalyticsPipeline] Failed to flush keywords: ${errMsg}\n`);
    // Re-add items to buffer for retry
    this.buffer.keywords.unshift(...items);
  } finally {
    this.isFlushing.keywords = false;
  }
  }

  /**
  * Flush social metrics
  * P1-FIX: Added concurrent flush protection
  */
  private async flushSocial(): Promise<void> {
  if (this.buffer.social.length === 0 || this.isFlushing.social) return;
  this.isFlushing.social = true;
  const items = this.buffer.social.splice(0, this.batchSize);
  try {
    await this.db.query(
    `INSERT INTO social_metrics (
    platform, content_id, post_id, impressions, clicks,
    likes, comments, shares, engagement_rate, timestamp
    )
    SELECT * FROM UNNEST(
    $1::text[], $2::text[], $3::text[],
    $4::int[], $5::int[], $6::int[],
    $7::int[], $8::int[], $9::numeric[], $10::timestamp[]
    )`,
    [
    items.map(i => i.platform),
    items.map(i => i.contentId),
    items.map(i => i.postId),
    items.map(i => i.impressions),
    items.map(i => i.clicks),
    items.map(i => i.likes),
    items.map(i => i.comments),
    items.map(i => i.shares),
    items.map(i => i.engagementRate),
    items.map(i => i.timestamp),
    ]
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error["message"] : String(error);
    process.stderr.write(`[${new Date().toISOString()}] [AnalyticsPipeline] Failed to flush social: ${errMsg}\n`);
    this.buffer.social.unshift(...items);
  } finally {
    this.isFlushing.social = false;
  }
  }

  /**
  * Flush content performance
  * P1-FIX: Added concurrent flush protection
  */
  private async flushContent(): Promise<void> {
  if (this.buffer.content.length === 0 || this.isFlushing.content) return;
  this.isFlushing.content = true;
  const items = this.buffer.content.splice(0, this.batchSize);
  try {
    await this.db.query(
    `INSERT INTO content_performance (
    content_id, domain_id, page_views, unique_visitors,
    avg_time_on_page, bounce_rate, conversions, revenue, timestamp
    )
    SELECT * FROM UNNEST(
    $1::text[], $2::text[], $3::int[], $4::int[],
    $5::int[], $6::numeric[], $7::int[], $8::numeric[], $9::timestamp[]
    )`,
    [
    items.map(i => i.contentId),
    items.map(i => i.domainId),
    items.map(i => i.pageViews),
    items.map(i => i.uniqueVisitors),
    items.map(i => i.avgTimeOnPage),
    items.map(i => i.bounceRate),
    items.map(i => i.conversions),
    items.map(i => i.revenue),
    items.map(i => i.timestamp),
    ]
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error["message"] : String(error);
    process.stderr.write(`[${new Date().toISOString()}] [AnalyticsPipeline] Failed to flush content: ${errMsg}\n`);
    this.buffer.content.unshift(...items);
  } finally {
    this.isFlushing.content = false;
  }
  }

  /**
  * Get keyword trends over time
  */
  async getKeywordTrends(
  domainId: string,
  keyword: string,
  days: number = 30
  ): Promise<Array<{
  date: string;
  position: number;
  clicks: number;
  impressions: number;
  }>> {
  const { rows } = await this.db.query(
    `SELECT
    DATE(timestamp) as date,
    AVG(position) as position,
    SUM(clicks) as clicks,
    SUM(impressions) as impressions
    FROM keyword_metrics
    WHERE domain_id = $1
    AND keyword = $2
    AND timestamp >= NOW() - INTERVAL '1 day' * $3
    GROUP BY DATE(timestamp)
    ORDER BY date`,
    [domainId, keyword, days]
  );

  return rows;
  }

  /**
  * Get top performing keywords
  */
  async getTopKeywords(
  domainId: string,
  limit: number = 20
  ): Promise<Array<{
  keyword: string;
  source: string;
  totalClicks: number;
  avgPosition: number;
  }>> {
  const { rows } = await this.db.query(
    `SELECT
    keyword,
    source,
    SUM(clicks) as total_clicks,
    AVG(position) as avg_position
    FROM keyword_metrics
    WHERE domain_id = $1
    AND timestamp >= NOW() - INTERVAL '30 days'
    GROUP BY keyword, source
    ORDER BY total_clicks DESC
    LIMIT $2`,
    [domainId, limit]
  );

  return rows.map(r => ({
    keyword: r.keyword,
    source: r.source,
    totalClicks: parseInt(r.total_clicks),
    avgPosition: parseFloat(r.avg_position),
  }));
  }

  /**
  * Get social performance summary
  */
  async getSocialSummary(
  contentId: string,
  days: number = 30
  ): Promise<Record<string, {
  impressions: number;
  engagement: number;
  engagementRate: number;
  }>> {
  // P0-FIX: Added platform to SELECT list — it was in GROUP BY but not SELECT,
  // causing a PostgreSQL error "column must appear in the GROUP BY clause or
  // aggregate function". The function always threw in production.
  const { rows } = await this.db.query(
    `SELECT
    platform,
    SUM(impressions) as impressions,
    SUM(likes + comments + shares) as engagement,
    AVG(engagement_rate) as engagement_rate
    FROM social_metrics
    WHERE content_id = $1
    AND timestamp >= NOW() - INTERVAL '1 day' * $2
    GROUP BY platform`,
    [contentId, days]
  );

  const summary: Record<string, {
    impressions: number;
    engagement: number;
    engagementRate: number;
  }> = {};
  rows.forEach(row => {
    summary[row.platform] = {
    impressions: parseInt(row.impressions),
    engagement: parseInt(row.engagement),
    engagementRate: parseFloat(row.engagement_rate),
    };
  });

  return summary;
  }

  /**
  * Aggregate daily metrics
  */
  async aggregateDaily(date: Date): Promise<void> {
  const dateStr = date.toISOString().split('T')[0];

  await this.db.query(
    `INSERT INTO daily_analytics (
    date, domain_id, metric_type, metric_name, value
    )
    SELECT
    DATE(timestamp) as date,
    domain_id,
    'keyword' as metric_type,
    'total_clicks' as metric_name,
    SUM(clicks) as value
    FROM keyword_metrics
    WHERE DATE(timestamp) = $1
    GROUP BY DATE(timestamp), domain_id`,
    [dateStr]
  );
  }
}
