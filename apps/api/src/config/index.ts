/**
 * Configuration Barrel Export
 * 
 * Centralized configuration exports for the API.
 * Re-exports from utils/config where appropriate and defines app-specific configs.
 */

// ============================================================================
// Re-exports from utils/config (shared configurations)
// ============================================================================

export {
  // API Configuration
  API_VERSIONS,
  API_BASE_URLS,
  DEFAULT_TIMEOUTS,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  RATE_LIMIT_CONFIG,
  
  // Type exports
  type ServiceName,
  type ApiBaseUrls,
  type TimeoutDuration,
  type RetryConfig,
  type CircuitBreakerConfig,
  type RateLimitConfig,
  type QueryParams,
  
  // Utility functions
  buildApiUrl,
  getMailchimpBaseUrl,
  getFacebookGraphUrl,
} from '../utils/config';

// ============================================================================
// Retry Configuration
// ============================================================================

/**
 * Retry configuration for HTTP requests and operations
 */
export const retryConfig = {
  /** Maximum number of retry attempts */
  maxRetries: 3,
  /** Base delay between retries in milliseconds */
  baseDelayMs: 1000,
  /** Maximum delay between retries in milliseconds */
  maxDelayMs: 30000,
  /** Minimum delay between retries in milliseconds */
  minDelayMs: 100,
  /** HTTP status codes that should trigger a retry */
  retryableStatuses: [408, 429, 500, 502, 503, 504] as const,
  /** Exponential backoff multiplier */
  backoffMultiplier: 2,
} as const;

// ============================================================================
// Pagination Configuration
// ============================================================================

/**
 * Pagination configuration for list endpoints
 */
export const paginationConfig = {
  /** Default limit for pagination */
  defaultLimit: 20,
  /** Maximum allowed limit for pagination */
  maxLimit: 100,
  /** Default limit for admin endpoints */
  adminDefaultLimit: 50,
  /** Maximum safe offset for offset-based pagination */
  maxSafeOffset: 10000,
} as const;

// ============================================================================
// Circuit Breaker Configuration
// ============================================================================

/**
 * Circuit breaker configuration for fault tolerance
 */
export const circuitBreakerConfig = {
  /** Number of failures before opening the circuit */
  failureThreshold: 5,
  /** Time in milliseconds before attempting to reset the circuit */
  resetTimeoutMs: 30000,
  /** Maximum attempts in half-open state */
  halfOpenMaxAttempts: 3,
} as const;

// ============================================================================
// Timeout Configuration
// ============================================================================

/**
 * Timeout configuration for various operation types (in milliseconds)
 */
export const timeoutConfig = {
  /** Short timeout for health checks (5 seconds) */
  short: 5000,
  /** Medium timeout for normal operations (15 seconds) */
  medium: 15000,
  /** Long timeout for complex operations (30 seconds) */
  long: 30000,
  /** Extended timeout for uploads/downloads (60 seconds) */
  extended: 60000,
  /** Maximum allowed timeout (5 minutes) */
  max: 300000,
} as const;

// ============================================================================
// Cache Configuration
// ============================================================================

/**
 * Cache configuration for various caching layers
 */
export const cacheConfig = {
  /** Cache version - bump to invalidate all cached data */
  version: 'v2',
  /** Default cache key prefix */
  prefix: 'api',
  /** Default TTL in milliseconds (5 minutes) */
  defaultTtlMs: 5 * 60 * 1000,
  /** Maximum cache key length */
  maxKeyLength: 1024,
  /** Maximum number of items in LRU cache */
  maxSize: 1000,
  /** Abort controller cache max size */
  abortControllerCacheMax: 1000,
  /** Abort controller cache TTL in milliseconds */
  abortControllerCacheTtlMs: 3600000,
  /** Circuit breaker cache max size */
  circuitBreakerCacheMax: 100,
  /** Circuit breaker cache TTL in milliseconds */
  circuitBreakerCacheTtlMs: 3600000,
} as const;

// ============================================================================
// Content Idea Generation Configuration
// ============================================================================

/**
 * Configuration for content idea generation job
 */
export const contentIdeaConfig = {
  /** Default maximum number of ideas to generate */
  defaultMaxIdeas: 5,
  /** Maximum allowed ideas per request */
  maxIdeas: 20,
  /** Minimum read time in minutes */
  minReadTime: 5,
  /** Maximum variance in read time */
  maxReadTimeVariance: 10,
  /** Base word count for competitive analysis */
  avgWordCountBase: 1500,
  /** Variance in word count */
  avgWordCountVariance: 500,
  /** Maximum keywords per idea */
  maxKeywordsPerIdea: 5,
  /** Maximum concurrent batches for processing */
  maxConcurrentBatches: 3,
  /** AI service failure threshold for circuit breaker */
  aiFailureThreshold: 3,
  /** AI service reset timeout in milliseconds */
  aiResetTimeoutMs: 60000,
} as const;

// ============================================================================
// Job Scheduler Configuration
// ============================================================================

/**
 * Configuration for background job processing
 */
export const jobConfig = {
  /** Maximum retry attempts for jobs */
  maxRetries: 3,
  /** Delay between retries in milliseconds */
  retryDelayMs: 1000,
  /** Default job timeout in milliseconds (2 minutes) */
  defaultTimeoutMs: 120000,
  /** Worker concurrency */
  workerConcurrency: 5,
  /** Batch size for job processing */
  batchSize: 50,
  /** Whether to keep completed jobs in queue */
  keepCompletedJobs: 50,
  /** Whether to keep failed jobs in queue */
  keepFailedJobs: 50,
  /** Worker rate limit max requests */
  workerRateLimitMax: 10,
  /** Worker rate limit duration in milliseconds */
  workerRateLimitDurationMs: 1000,
} as const;

// ============================================================================
// Redis Configuration
// ============================================================================

/**
 * Redis connection and behavior configuration
 */
export const redisConfig = {
  /** Initial reconnection delay in milliseconds */
  initialReconnectDelayMs: 1000,
  /** Maximum reconnection delay in milliseconds */
  maxReconnectDelayMs: 30000,
  /** Maximum reconnection attempts */
  maxReconnectAttempts: 10,
  /** Maximum retries per request */
  maxRetriesPerRequest: 3,
  /** Connection timeout in milliseconds */
  connectTimeoutMs: 10000,
  /** Command timeout in milliseconds */
  commandTimeoutMs: 5000,
  /** Keepalive interval in milliseconds */
  keepAliveMs: 30000,
  /** Wait for connection timeout in milliseconds */
  waitForConnectionTimeoutMs: 30000,
} as const;

// ============================================================================
// Export Configuration
// ============================================================================

/**
 * Configuration for data export jobs
 */
export const exportConfig = {
  /** Maximum download size in bytes (10MB) */
  maxDownloadSize: 10 * 1024 * 1024,
  /** Maximum CSV rows allowed */
  maxCsvRows: 10000,
  /** CSV batch processing size */
  csvBatchSize: 1000,
  /** Export data version */
  dataVersion: '1.0',
  /** Default export expires in days for local storage */
  localExpiresDays: 7,
  /** Default export expires in days for download */
  downloadExpiresDays: 1,
} as const;

// ============================================================================
// Publishing Configuration
// ============================================================================

/**
 * Configuration for publish execution jobs
 */
export const publishingConfig = {
  /** Default maximum retries for publishing */
  defaultMaxRetries: 3,
  /** Job timeout in milliseconds (5 minutes) */
  jobTimeoutMs: 300000,
  /** Circuit breaker failure threshold */
  circuitBreakerFailureThreshold: 5,
  /** Circuit breaker reset timeout in milliseconds */
  circuitBreakerResetTimeoutMs: 30000,
  /** Circuit breaker half-open max calls */
  circuitBreakerHalfOpenMaxCalls: 3,
} as const;

// ============================================================================
// Billing Configuration
// ============================================================================

/**
 * Interface for billing configuration
 */
export interface BillingConfig {
  /** Stripe secret key */
  stripeSecretKey: string;
  /** JWT signing key */
  jwtKey: string;
}

/**
 * Get billing configuration from environment variables
 * @returns BillingConfig object
 * @throws Error if required configuration is missing
 */
export function getBillingConfig(): BillingConfig {
  const stripeSecretKey = process.env['STRIPE_SECRET_KEY'] || '';
  const jwtKey = process.env['JWT_KEY_1'] || '';

  if (!stripeSecretKey && process.env['NODE_ENV'] === 'production') {
    console.warn('[BillingConfig] STRIPE_SECRET_KEY not configured');
  }

  if (!jwtKey && process.env['NODE_ENV'] === 'production') {
    console.warn('[BillingConfig] JWT_KEY_1 not configured');
  }

  return {
    stripeSecretKey,
    jwtKey,
  };
}

// ============================================================================
// Database Configuration
// ============================================================================

/**
 * Database query configuration
 */
export const dbConfig = {
  /** Default query timeout in milliseconds (30 seconds) */
  queryTimeoutMs: 30000,
  /** Connection pool size */
  poolSize: 20,
  /** Connection timeout in milliseconds */
  connectionTimeoutMs: 10000,
  /** Idle connection timeout in milliseconds */
  idleTimeoutMs: 300000,
} as const;

// ============================================================================
// Abuse Guard Configuration
// ============================================================================

/**
 * Configuration for abuse detection and content validation
 */
export const abuseGuardConfig = {
  /** Maximum content length allowed */
  maxContentLength: 100000,
  /** Risk score threshold for blocking (0-100) */
  blockThreshold: 75,
  /** Risk score threshold for requiring review (0-100) */
  reviewThreshold: 50,
  /** Maximum risk flags allowed */
  maxRiskFlags: 20,
  /** Content length warning threshold */
  contentLengthWarning: 10000,
  /** Content length high risk threshold */
  contentLengthHigh: 50000,
  /** Content length critical threshold */
  contentLengthCritical: 100000,
} as const;

// ============================================================================
// Default Export
// ============================================================================

export default {
  retryConfig,
  paginationConfig,
  circuitBreakerConfig,
  timeoutConfig,
  cacheConfig,
  contentIdeaConfig,
  jobConfig,
  redisConfig,
  exportConfig,
  publishingConfig,
  dbConfig,
  abuseGuardConfig,
};
