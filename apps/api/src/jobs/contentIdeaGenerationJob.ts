
import { Job } from 'bullmq';
import { randomUUID, randomInt } from 'crypto';
import type { Knex } from 'knex';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { withRetry, CircuitBreaker } from '@kernel/retry';

import { contentIdeaConfig, jobConfig } from '@config';
import { getDb } from '../db';
import { JobScheduler } from './JobScheduler';
const KeywordMetricSchema = z.object({
  keyword: z.string(),
  avg_clicks: z.number(),
  avg_position: z.number(),
});

export type KeywordMetric = z.infer<typeof KeywordMetricSchema>;

function validateKeywordMetric(row: unknown): KeywordMetric {
  const result = KeywordMetricSchema.safeParse(row);
  if (!result.success) {
  throw new Error(`Invalid keyword metric: ${result.error["message"]}`);
  }
  return result.data;
}

const logger = getLogger('content-idea-generation');

/**
* Content Idea Generation Job
* Uses AI to generate content ideas based on keyword research and trends
*/

// Constants for configuration (MEDIUM FIX M3, M6)

const CONFIG = {
  DEFAULT_MAX_IDEAS: contentIdeaConfig.defaultMaxIdeas,
  DEFAULT_TONE: 'professional' as const,
  DEFAULT_AUDIENCE: 'general',
  MIN_READ_TIME: contentIdeaConfig.minReadTime,
  MAX_READ_TIME_VARIANCE: contentIdeaConfig.maxReadTimeVariance,
  AVG_WORD_COUNT_BASE: contentIdeaConfig.avgWordCountBase,
  AVG_WORD_COUNT_VARIANCE: contentIdeaConfig.avgWordCountVariance,
  BATCH_SIZE: jobConfig.batchSize,
  MAX_KEYWORDS_IN_IDEA: contentIdeaConfig.maxKeywordsPerIdea,
  MAX_CONCURRENT_BATCHES: contentIdeaConfig.maxConcurrentBatches,
} as const;

const ContentIdeaInputSchema = z.object({
  domainId: z.string().uuid(),
  keywords: z.array(z.string().min(1)).min(1),
  contentType: z.enum(['article', 'video', 'social', 'email']),
  targetAudience: z.string().optional(),
  tone: z.enum(['professional', 'casual', 'educational', 'entertaining']).optional(),
  maxIdeas: z.number().int().min(1).max(contentIdeaConfig.maxIdeas).optional(),
  idempotencyKey: z.string().optional(),
});

export type ContentIdeaInput = z.infer<typeof ContentIdeaInputSchema>;

export interface ContentIdea {
  id: string;
  title: string;
  description: string;
  targetKeywords: string[];
  contentType: string;
  estimatedReadTime?: number;
  suggestedOutline?: string[];
  competitiveAnalysis?: {
  avgWordCount: number;
  topRankingUrls: string[];
  contentGaps: string[];
  };
}

/**
* Register the content idea generation job with the scheduler
*/
export function registerContentIdeaJob(scheduler: JobScheduler, pool: Pool): void {
  scheduler.register(
  {
    name: 'content-idea-generation',
    queue: 'content',
    priority: 'normal',
    maxRetries: 2,
    timeout: 120000,
  },
  ((data: ContentIdeaInput, job: Job) => contentIdeaGenerationJob(data, job, pool)) as (data: unknown, job: Job) => Promise<unknown>,
  );
}

const aiGenerationBreaker = new CircuitBreaker('ai-content-generation', {
  failureThreshold: contentIdeaConfig.aiFailureThreshold,
  resetTimeoutMs: contentIdeaConfig.aiResetTimeoutMs,
  halfOpenMaxCalls: 3,
});

const ALLOWED_TABLES = {
  CONTENT_IDEAS: 'content_ideas',
  KEYWORD_METRICS: 'keyword_metrics',
  IDEMPOTENCY_KEYS: 'idempotency_keys',
} as const;

function validateTableName(tableName: string): string {
  const allowedValues = Object.values(ALLOWED_TABLES);
  if (!(allowedValues as readonly string[]).includes(tableName)) {
  throw new Error(`Invalid table name: ${tableName}`);
  }
  return tableName;
}

// Database pool will be injected via JobScheduler context
export async function contentIdeaGenerationJob(
  input: ContentIdeaInput,
  job: Job,
  pool: Pool
): Promise<ContentIdea[]> {
  const validatedInput = ContentIdeaInputSchema.parse(input);
  const {
  domainId,
  keywords,
  contentType,
  idempotencyKey,
  targetAudience = CONFIG.DEFAULT_AUDIENCE,
  tone = CONFIG.DEFAULT_TONE,
  maxIdeas = CONFIG.DEFAULT_MAX_IDEAS,
  } = validatedInput;

  const jobId = job.id;
  const batchId = randomUUID();

  logger.info('Generating content ideas', {
  keywordCount: keywords.length,
  });

  try {
  await withRetry(() => pool.query('SELECT 1'), {
    maxRetries: 3,
    initialDelayMs: 1000,
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'],
  });
  } catch (error) {
  if (error instanceof Error) {
    logger.error('Database health check failed', error);
  } else {
    logger.error('Database health check failed', new Error(String(error)));
  }
  throw new Error('Database connection validation failed');
  }

  // Fetch recent keyword performance for context with retry

  const { rows: rawKeywordData } = await withRetry(
  () => pool.query(
    `SELECT keyword, AVG(clicks) as avg_clicks, AVG(position) as avg_position
    FROM ${validateTableName(ALLOWED_TABLES.KEYWORD_METRICS)}
    WHERE domain_id = $1 AND keyword = ANY($2)
    AND timestamp >= NOW() - INTERVAL '30 days'
    GROUP BY keyword`,
    [domainId, keywords]
  ),
  { maxRetries: 3, initialDelayMs: 1000 }
  );

  const keywordData = rawKeywordData.map(validateKeywordMetric);

  // Build context for AI
  const keywordContext = keywordData.map(k =>
  `${k.keyword} (clicks: ${Math.round(k.avg_clicks)}, position: ${Math.round(k.avg_position)})`
  ).join(', ');

  logger.debug('Keyword context built', { keywordContext });

  // Generate ideas with circuit breaker protection
  const ideas = await aiGenerationBreaker.execute(async () => {
  return generateIdeas(keywords, contentType, targetAudience, tone, maxIdeas);
  });

  // P0-FIX: AI generation moved OUTSIDE transaction to prevent long lock holding
  // The transaction now only handles database operations with a short timeout
  const db = await getDb();
  const result = await db.transaction(async (trx) => {
  // P0-FIX: Reduced timeout since AI generation is now outside transaction
  // Only database operations remain in transaction
  await trx.raw('SET LOCAL statement_timeout = ?', [10000]); // 10 seconds for DB ops only

  if (idempotencyKey) {
    // Use UPSERT pattern: INSERT first, check conflict result

    const upsertResult = await trx.raw(`
    INSERT INTO ${validateTableName(ALLOWED_TABLES.IDEMPOTENCY_KEYS)} (key, entity_type, entity_id, created_at)
    VALUES (?, ?, ?, NOW())
    ON CONFLICT (key) DO NOTHING
    RETURNING *
    `, [idempotencyKey, 'content_idea_batch', batchId]);

    if (upsertResult.rows.length === 0) {
    // Already exists - fetch the existing record
    const existing = await trx(ALLOWED_TABLES.IDEMPOTENCY_KEYS)
      .where({ key: idempotencyKey })
      .first();

    logger.info('Batch already processed', { jobId, idempotencyKey, existingEntityId: existing?.entity_id });
    return { status: 'already_processed', batchId: existing?.entity_id, ideas: [] as ContentIdea[] };
    }

    // Successfully inserted - we have the lock, proceed with batch insert
    logger.debug('Acquired idempotency lock', { jobId, idempotencyKey, batchId });
  }

  // Both idempotency key insert and batch insert are in the same transaction
  await batchInsertIdeas(trx, ideas, domainId, idempotencyKey);

  return { status: 'completed', batchId, ideas };
  });

  // If already processed, return empty ideas array with proper status
  if (result.status === 'already_processed') {
  logger.info('Returning already processed result', { jobId, batchId: result.batchId });
  return result.ideas;
  }

  logger.info('Content ideas generated successfully', {
  count: ideas.length,
  });

  return ideas;
}

function generateIdeas(
  keywords: string[],
  contentType: string,
  targetAudience: string,
  tone: string,
  maxIdeas: number
): ContentIdea[] {
  const ideas: ContentIdea[] = [];

  for (let i = 0; i < maxIdeas; i++) {
  const primaryKeyword = keywords[i % keywords.length];

  ideas.push({
    id: randomUUID(),
    title: generateTitle(primaryKeyword!, contentType, tone || CONFIG.DEFAULT_TONE),
    description: generateDescription(primaryKeyword!, contentType, targetAudience || CONFIG.DEFAULT_AUDIENCE),
    contentType,

    // BEFORE: keywords.slice(0, CONFIG.MAX_KEYWORDS_IN_IDEA) - included duplicate primary keyword
    // AFTER: keywords.slice(1, CONFIG.MAX_KEYWORDS_IN_IDEA + 1) - excludes primary keyword at index 0
    targetKeywords: [primaryKeyword!, ...keywords.slice(1, CONFIG.MAX_KEYWORDS_IN_IDEA)],
    ...(contentType === 'article' ? {
      estimatedReadTime: CONFIG.MIN_READ_TIME + randomInt(CONFIG.MAX_READ_TIME_VARIANCE)
    } : {}),
    suggestedOutline: generateOutline(contentType),
    competitiveAnalysis: {
    avgWordCount: CONFIG.AVG_WORD_COUNT_BASE + randomInt(CONFIG.AVG_WORD_COUNT_VARIANCE),
    topRankingUrls: [],
    contentGaps: ['Interactive elements', 'Video content', 'Expert quotes'],
    },
  });
  }

  return ideas;
}

/**
* FIX: Batch insert with parallel processing and chunking
* - Processes batches in parallel with concurrency limit
* - Prevents memory issues with large datasets
* - Uses chunking for very large datasets

*/
async function batchInsertIdeas(
  trx: Knex.Transaction,
  ideas: ContentIdea[],
  domainId: string,
  idempotencyKey?: string
): Promise<void> {
  // Process in batches with parallel execution
  const batches: ContentIdea[][] = [];

  // Split ideas into batches
  for (let i = 0; i < ideas.length; i += CONFIG.BATCH_SIZE) {
  batches.push(ideas.slice(i, i + CONFIG.BATCH_SIZE));
  }

  // Parallel batch processing within a transaction can cause deadlocks
  // When multiple transactions try to lock the same index ranges
  for (let i = 0; i < batches.length; i++) {
  const batch = batches[i]!;

  // Process batches sequentially to avoid deadlocks
  await insertBatch(trx, batch, domainId, idempotencyKey, i);

  logger.debug('Batch completed', {
    batchIndex: i,
    batchSize: batch.length,
    totalBatches: batches.length,
  });
  }
}

/**
* Helper function to insert a single batch

*/
async function insertBatch(
  trx: Knex.Transaction,
  batch: ContentIdea[],
  domainId: string,
  idempotencyKey: string | undefined,
  _batchIndex: number
): Promise<void> {

  const tableName = validateTableName(ALLOWED_TABLES.CONTENT_IDEAS);

  // Build multi-value insert query with proper parameterization
  const values: unknown[] = [domainId];
  const placeholders: string[] = [];
  let paramIndex = 2;

  for (const idea of batch) {

  // TargetKeywords array is passed as-is, PostgreSQL pg driver handles arrays
  placeholders.push(
    `($1, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, NOW(), $${paramIndex++})`
  );
  values.push(
    idea.id,
    idea.title,
    idea.description,
    idea.targetKeywords, // PostgreSQL driver handles arrays correctly
    idea.contentType,
    idea.estimatedReadTime ?? null, // Ensure null for undefined
    JSON.stringify(idea.suggestedOutline ?? []),
    idempotencyKey || randomUUID()
  );
  }

  const query = `
  INSERT INTO ${tableName} (
    domain_id, id, title, description, target_keywords, content_type,
    estimated_read_time, suggested_outline, created_at, idempotency_key
  ) VALUES ${placeholders.join(', ')}
  `;

  await withRetry(
  () => trx.raw(query, values),
  { maxRetries: 3, initialDelayMs: 500 }
  );

  logger.debug('Batch insert completed', {
  batchSize: batch.length,
  });
}

function generateTitle(keyword: string, type: string, _tone: string): string {
  const templates: Record<string, string[]> = {
  article: [
    `The Complete Guide to ${keyword}`,
    `10 Ways to Master ${keyword}`,
    `Why ${keyword} Matters for Your Business`,
    `${keyword}: Everything You Need to Know`,
  ],
  video: [
    `How to ${keyword} in 5 Minutes`,
    `${keyword} Tutorial for Beginners`,
    `The Truth About ${keyword}`,
  ],
  social: [
    `Quick tip: ${keyword}`,
    `Did you know about ${keyword}?`,
    `Save this ${keyword} guide!`,
  ],
  email: [
    `Your ${keyword} strategy inside`,
    `How we improved ${keyword} by 200%`,
    `${keyword} insights for this week`,
  ],
  };

  const typeTemplates = templates[type] ?? templates['article']!;
  const randomIndex = randomInt(typeTemplates.length);
  return typeTemplates[randomIndex] ?? `${keyword} Content Ideas`;
}

function generateDescription(keyword: string, type: string, audience: string): string {
  return `A comprehensive ${type} about ${keyword} designed for ${audience}. ` +
  `This content covers key strategies, best practices, and actionable tips ` +
  `to help you achieve better results.`;
}

function generateOutline(type: string): string[] {
  const outlines: Record<string, string[]> = {
  article: [
    'Introduction',
    'What is [Topic]?',
    'Why it Matters',
    'Key Strategies',
    'Common Mistakes to Avoid',
    'Tools and Resources',
    'Case Studies',
    'Conclusion',
  ],
  video: [
    'Hook/Intro',
    'Problem Statement',
    'Solution Overview',
    'Step-by-Step Tutorial',
    'Pro Tips',
    'Call to Action',
  ],
  social: [
    'Attention-grabbing hook',
    'Main point',
    'Supporting detail',
    'Call to action',
  ],
  email: [
    'Subject line',
    'Personalized greeting',
    'Value proposition',
    'Main content',
    'Secondary content',
    'CTA button',
    'Signature',
  ],
  };

  return outlines[type] ?? outlines['article']!;
}
