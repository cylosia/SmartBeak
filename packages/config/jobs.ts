/**
 * Job Queue Configuration
 * 
 * Background job processing settings.
 */

import { parseIntEnv } from './env';

export const jobConfig = {
  /** Number of concurrent workers */
  workerConcurrency: parseIntEnv('JOB_WORKER_CONCURRENCY', 5),

  /** Batch size for database operations */
  batchSize: parseIntEnv('JOB_BATCH_SIZE', 100),

  /** Maximum number of retries for failed jobs */
  maxRetries: parseIntEnv('JOB_MAX_RETRIES', 3),

  /** Base delay between retries in milliseconds */
  retryDelayMs: parseIntEnv('JOB_RETRY_DELAY_MS', 1000),

  /** Maximum delay between retries in milliseconds */
  maxRetryDelayMs: parseIntEnv('JOB_MAX_RETRY_DELAY_MS', 30000),

  /** Default job timeout in milliseconds (5 minutes) */
  defaultTimeoutMs: parseIntEnv('JOB_DEFAULT_TIMEOUT_MS', 300000),

  /** High priority job timeout in milliseconds (2 minutes) */
  highPriorityTimeoutMs: parseIntEnv('JOB_HIGH_PRIORITY_TIMEOUT_MS', 120000),

  /** Export job timeout in milliseconds (10 minutes) */
  exportTimeoutMs: parseIntEnv('JOB_EXPORT_TIMEOUT_MS', 600000),

  /** Publishing job timeout in milliseconds (5 minutes) */
  publishingTimeoutMs: parseIntEnv('JOB_PUBLISHING_TIMEOUT_MS', 300000),

  /** Worker rate limit max requests */
  workerRateLimitMax: parseIntEnv('JOB_WORKER_RATE_LIMIT_MAX', 100),

  /** Worker rate limit duration in milliseconds */
  workerRateLimitDurationMs: parseIntEnv('JOB_WORKER_RATE_LIMIT_DURATION_MS', 1000),

  /** Completed jobs to keep per queue */
  keepCompletedJobs: parseIntEnv('JOB_KEEP_COMPLETED', 100),

  /** Failed jobs to keep per queue */
  keepFailedJobs: parseIntEnv('JOB_KEEP_FAILED', 50),
} as const;

/**
 * Content idea generation configuration
 */
export const contentIdeaConfig = {
  /** Maximum ideas to generate per request */
  maxIdeasPerRequest: parseIntEnv('CONTENT_IDEA_MAX_PER_REQUEST', 10),
  /** Default timeout for idea generation in milliseconds */
  timeoutMs: parseIntEnv('CONTENT_IDEA_TIMEOUT_MS', 30000),
  /** Default maximum ideas */
  defaultMaxIdeas: parseIntEnv('CONTENT_IDEA_DEFAULT_MAX_IDEAS', 10),
  /** Maximum ideas total */
  maxIdeas: parseIntEnv('CONTENT_IDEA_MAX_IDEAS', 20),
  /** Minimum read time in minutes */
  minReadTime: parseIntEnv('CONTENT_IDEA_MIN_READ_TIME', 3),
  /** Max read time variance in minutes */
  maxReadTimeVariance: parseIntEnv('CONTENT_IDEA_MAX_READ_TIME_VARIANCE', 5),
  /** Average word count base */
  avgWordCountBase: parseIntEnv('CONTENT_IDEA_AVG_WORD_COUNT_BASE', 1000),
  /** Average word count variance */
  avgWordCountVariance: parseIntEnv('CONTENT_IDEA_AVG_WORD_COUNT_VARIANCE', 500),
  /** Maximum keywords per idea */
  maxKeywordsPerIdea: parseIntEnv('CONTENT_IDEA_MAX_KEYWORDS', 5),
  /** Maximum concurrent batches */
  maxConcurrentBatches: parseIntEnv('CONTENT_IDEA_MAX_CONCURRENT_BATCHES', 3),
  /** AI failure threshold for circuit breaker */
  aiFailureThreshold: parseIntEnv('CONTENT_IDEA_AI_FAILURE_THRESHOLD', 5),
  /** AI reset timeout in milliseconds */
  aiResetTimeoutMs: parseIntEnv('CONTENT_IDEA_AI_RESET_MS', 30000),
} as const;

/**
 * Export job configuration
 */
export const exportConfig = {
  /** Maximum rows per export file */
  maxRowsPerFile: parseIntEnv('EXPORT_MAX_ROWS_PER_FILE', 10000),
  // P2-4 AUDIT FIX: Validate the format against allowed values. Previously any
  // string (e.g., 'xml') was accepted silently, causing runtime errors.
  /** Default export format */
  defaultFormat: (() => {
    const allowed = ['json', 'csv', 'pdf', 'markdown'] as const;
    const val = process.env['EXPORT_DEFAULT_FORMAT'] || 'json';
    return allowed.includes(val as typeof allowed[number]) ? val : 'json';
  })(),
  /** Export file retention in days */
  retentionDays: parseIntEnv('EXPORT_RETENTION_DAYS', 7),
} as const;

/**
 * Publishing configuration
 */
export const publishingConfig = {
  /** Maximum scheduled posts per user */
  maxScheduledPerUser: parseIntEnv('PUBLISHING_MAX_SCHEDULED_PER_USER', 100),
  /** Default publishing timeout in milliseconds */
  defaultTimeoutMs: parseIntEnv('PUBLISHING_TIMEOUT_MS', 300000),
  /** Retry attempts for failed publishes */
  maxRetries: parseIntEnv('PUBLISHING_MAX_RETRIES', 3),
  /** Default max retries for publishing jobs */
  defaultMaxRetries: parseIntEnv('PUBLISHING_DEFAULT_MAX_RETRIES', 3),
  /** Job timeout in milliseconds */
  jobTimeoutMs: parseIntEnv('PUBLISHING_JOB_TIMEOUT_MS', 300000),
  /** Circuit breaker failure threshold */
  circuitBreakerFailureThreshold: parseIntEnv('PUBLISHING_CIRCUIT_FAILURE_THRESHOLD', 5),
  /** Circuit breaker reset timeout in milliseconds */
  circuitBreakerResetTimeoutMs: parseIntEnv('PUBLISHING_CIRCUIT_RESET_MS', 30000),
  /** Circuit breaker half open max calls */
  circuitBreakerHalfOpenMaxCalls: parseIntEnv('PUBLISHING_CIRCUIT_HALF_OPEN_MAX', 3),
} as const;
