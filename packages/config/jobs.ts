/**
 * Job Queue Configuration
 *
 * Background job processing settings.
 */

import { getLogger } from '@kernel/logger';
import { parseIntEnv } from './env';

const logger = getLogger('config:jobs');

export const jobConfig = {
  /** Number of concurrent workers */
  // P1-6 FIX: Add min/max bounds to prevent resource exhaustion from misconfigured env vars
  workerConcurrency: parseIntEnv('JOB_WORKER_CONCURRENCY', 5, { min: 1, max: 100 }),

  /** Batch size for database operations */
  batchSize: parseIntEnv('JOB_BATCH_SIZE', 100, { min: 1, max: 10000 }),

  /** Maximum number of retries for failed jobs */
  // AUDIT-FIX H10: Add bounds. maxRetries=999999999 causes infinite retry loops.
  maxRetries: parseIntEnv('JOB_MAX_RETRIES', 3, { min: 0, max: 20 }),

  /** Base delay between retries in milliseconds */
  // AUDIT-FIX H10: Add bounds. retryDelayMs=0 causes CPU spin on retries.
  retryDelayMs: parseIntEnv('JOB_RETRY_DELAY_MS', 1000, { min: 100, max: 60000 }),

  /** Maximum delay between retries in milliseconds */
  maxRetryDelayMs: parseIntEnv('JOB_MAX_RETRY_DELAY_MS', 30000, { min: 1000, max: 600000 }),

  /** Default job timeout in milliseconds (5 minutes) */
  // AUDIT-FIX M25: Add bounds. timeout=0 causes instant job failure.
  defaultTimeoutMs: parseIntEnv('JOB_DEFAULT_TIMEOUT_MS', 300000, { min: 1000, max: 3600000 }),

  /** High priority job timeout in milliseconds (2 minutes) */
  highPriorityTimeoutMs: parseIntEnv('JOB_HIGH_PRIORITY_TIMEOUT_MS', 120000, { min: 1000, max: 3600000 }),

  /** Export job timeout in milliseconds (10 minutes) */
  exportTimeoutMs: parseIntEnv('JOB_EXPORT_TIMEOUT_MS', 600000, { min: 1000, max: 7200000 }),

  /** Publishing job timeout in milliseconds (5 minutes) */
  publishingTimeoutMs: parseIntEnv('JOB_PUBLISHING_TIMEOUT_MS', 300000, { min: 1000, max: 3600000 }),

  /** Worker rate limit max requests */
  workerRateLimitMax: parseIntEnv('JOB_WORKER_RATE_LIMIT_MAX', 100, { min: 1, max: 10000 }),

  /** Worker rate limit duration in milliseconds */
  workerRateLimitDurationMs: parseIntEnv('JOB_WORKER_RATE_LIMIT_DURATION_MS', 1000, { min: 100, max: 60000 }),

  /** Completed jobs to keep per queue */
  keepCompletedJobs: parseIntEnv('JOB_KEEP_COMPLETED', 100, { min: 0, max: 100000 }),

  /** Failed jobs to keep per queue */
  keepFailedJobs: parseIntEnv('JOB_KEEP_FAILED', 50, { min: 0, max: 100000 }),
} as const;

// AUDIT-FIX P3: Runtime freeze. `as const` only affects TypeScript types;
// it does not prevent runtime mutation. Object.freeze prevents accidental
// mutation of config values after startup.
Object.freeze(jobConfig);

// AUDIT-FIX M24: Validate that retryDelayMs < maxRetryDelayMs at config load time.
if (jobConfig.retryDelayMs >= jobConfig.maxRetryDelayMs) {
  logger.warn('JOB_RETRY_DELAY_MS >= JOB_MAX_RETRY_DELAY_MS. Exponential backoff will not increase delay.', {
    retryDelayMs: jobConfig.retryDelayMs,
    maxRetryDelayMs: jobConfig.maxRetryDelayMs,
  });
}

/**
 * Content idea generation configuration
 */
export const contentIdeaConfig = {
  /** Maximum ideas to generate per request */
  maxIdeasPerRequest: parseIntEnv('CONTENT_IDEA_MAX_PER_REQUEST', 10, { min: 1, max: 100 }),
  /** Default timeout for idea generation in milliseconds */
  timeoutMs: parseIntEnv('CONTENT_IDEA_TIMEOUT_MS', 30000, { min: 1000, max: 300000 }),
  /** Default maximum ideas */
  defaultMaxIdeas: parseIntEnv('CONTENT_IDEA_DEFAULT_MAX_IDEAS', 10, { min: 1, max: 100 }),
  /** Maximum ideas total */
  maxIdeas: parseIntEnv('CONTENT_IDEA_MAX_IDEAS', 20, { min: 1, max: 200 }),
  /** Minimum read time in minutes */
  minReadTime: parseIntEnv('CONTENT_IDEA_MIN_READ_TIME', 3, { min: 1, max: 60 }),
  /** Max read time variance in minutes */
  maxReadTimeVariance: parseIntEnv('CONTENT_IDEA_MAX_READ_TIME_VARIANCE', 5, { min: 0, max: 60 }),
  /** Average word count base */
  avgWordCountBase: parseIntEnv('CONTENT_IDEA_AVG_WORD_COUNT_BASE', 1000, { min: 100, max: 50000 }),
  /** Average word count variance */
  avgWordCountVariance: parseIntEnv('CONTENT_IDEA_AVG_WORD_COUNT_VARIANCE', 500, { min: 0, max: 10000 }),
  /** Maximum keywords per idea */
  maxKeywordsPerIdea: parseIntEnv('CONTENT_IDEA_MAX_KEYWORDS', 5, { min: 1, max: 50 }),
  /** Maximum concurrent batches */
  maxConcurrentBatches: parseIntEnv('CONTENT_IDEA_MAX_CONCURRENT_BATCHES', 3, { min: 1, max: 20 }),
  /** AI failure threshold for circuit breaker */
  aiFailureThreshold: parseIntEnv('CONTENT_IDEA_AI_FAILURE_THRESHOLD', 5, { min: 1, max: 100 }),
  /** AI reset timeout in milliseconds */
  aiResetTimeoutMs: parseIntEnv('CONTENT_IDEA_AI_RESET_MS', 30000, { min: 1000, max: 300000 }),
} as const;
Object.freeze(contentIdeaConfig);

/**
 * Export job configuration
 */
// AUDIT-FIX M26: defaultFormat now returns a typed union instead of string.
type ExportFormat = 'json' | 'csv' | 'xlsx';
const ALLOWED_FORMATS: readonly ExportFormat[] = ['json', 'csv', 'xlsx'] as const;

// AUDIT-FIX P2: Type guard instead of unsafe `as ExportFormat` cast.
// If ExportFormat and ALLOWED_FORMATS diverge, the cast would be unsound.
function isExportFormat(value: string): value is ExportFormat {
  return (ALLOWED_FORMATS as readonly string[]).includes(value);
}

export const exportConfig = {
  /** Maximum rows per export file */
  maxRowsPerFile: parseIntEnv('EXPORT_MAX_ROWS_PER_FILE', 10000, { min: 1, max: 1000000 }),
  /** Default export format — validated against allowed values */
  // AUDIT-FIX P3: Log warning on invalid format. Previously fell back to 'json'
  // silently, so operators setting EXPORT_DEFAULT_FORMAT=pdf would get JSON exports
  // with no indication of misconfiguration.
  defaultFormat: ((): ExportFormat => {
    const raw = process.env['EXPORT_DEFAULT_FORMAT'];
    if (!raw) return 'json';
    if (isExportFormat(raw)) return raw;
    logger.warn('Invalid EXPORT_DEFAULT_FORMAT, using default "json"', {
      value: raw,
      allowed: ALLOWED_FORMATS,
    });
    return 'json';
  })(),
  /** Export file retention in days */
  retentionDays: parseIntEnv('EXPORT_RETENTION_DAYS', 7, { min: 1, max: 365 }),
} as const;
Object.freeze(exportConfig);

/**
 * Publishing configuration
 */
export const publishingConfig = {
  /** Maximum scheduled posts per user */
  maxScheduledPerUser: parseIntEnv('PUBLISHING_MAX_SCHEDULED_PER_USER', 100, { min: 1, max: 10000 }),
  /** Publishing timeout in milliseconds */
  // AUDIT-FIX P2: Consolidated defaultTimeoutMs and jobTimeoutMs into a single
  // timeoutMs. Both read different env vars but had identical defaults (300000ms),
  // creating confusion about which is authoritative. Consumers should use timeoutMs.
  timeoutMs: parseIntEnv('PUBLISHING_TIMEOUT_MS', 300000, { min: 1000, max: 3600000 }),
  /** @deprecated Use timeoutMs instead. Alias kept for backward compatibility. */
  defaultTimeoutMs: parseIntEnv('PUBLISHING_TIMEOUT_MS', 300000, { min: 1000, max: 3600000 }),
  /** Retry attempts for failed publishes */
  // AUDIT-FIX P2: Consolidated maxRetries and defaultMaxRetries into a single
  // maxRetries. Both had identical defaults (3), creating ambiguity.
  maxRetries: parseIntEnv('PUBLISHING_MAX_RETRIES', 3, { min: 0, max: 20 }),
  /** @deprecated Use maxRetries instead. Alias kept for backward compatibility. */
  defaultMaxRetries: parseIntEnv('PUBLISHING_MAX_RETRIES', 3, { min: 0, max: 20 }),
  /** @deprecated Use timeoutMs instead. Alias kept for backward compatibility. */
  jobTimeoutMs: parseIntEnv('PUBLISHING_TIMEOUT_MS', 300000, { min: 1000, max: 3600000 }),
  /** Circuit breaker failure threshold */
  circuitBreakerFailureThreshold: parseIntEnv('PUBLISHING_CIRCUIT_FAILURE_THRESHOLD', 5, { min: 1, max: 100 }),
  /** Circuit breaker reset timeout in milliseconds */
  circuitBreakerResetTimeoutMs: parseIntEnv('PUBLISHING_CIRCUIT_RESET_MS', 30000, { min: 1000, max: 600000 }),
  /** Circuit breaker half open max calls */
  circuitBreakerHalfOpenMaxCalls: parseIntEnv('PUBLISHING_CIRCUIT_HALF_OPEN_MAX', 3, { min: 1, max: 50 }),
} as const;
Object.freeze(publishingConfig);
