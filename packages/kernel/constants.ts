/**
* Application Constants
*
* MEDIUM FIX M6: Extract magic numbers to constants
* All hardcoded values have been extracted to named constants
* for better maintainability and configuration.
*/

// ============================================================================
// Time Constants (in milliseconds)
// ============================================================================

/** Time constants in milliseconds - MEDIUM FIX M6 */
export const TIME = {
  MILLISECOND: 1,
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000,
  YEAR: 365 * 24 * 60 * 60 * 1000,
} as const;

// ============================================================================
// Time Constants (in seconds)
// ============================================================================

/** Time constants in seconds - MEDIUM FIX M6 */
export const TIME_SECONDS = {
  MINUTE: 60,
  HOUR: 3600,
  DAY: 86400,
  WEEK: 604800,
  MONTH: 2592000, // 30 days
  YEAR: 31536000, // 365 days
} as const;

// ============================================================================
// Database Constants - MEDIUM FIX M6
// ============================================================================

/** Database-related constants - MEDIUM FIX M6 */
export const DB = {
  // Pool settings
  POOL_MIN_CONNECTIONS: 2,
  POOL_MAX_CONNECTIONS: 20,
  POOL_IDLE_TIMEOUT_MS: 30000,
  POOL_CONNECTION_TIMEOUT_MS: 5000,

  // Query limits - MEDIUM FIX I5: Add range validation
  MAX_QUERY_LIMIT: 1000,
  DEFAULT_QUERY_LIMIT: 50,
  MIN_QUERY_LIMIT: 1,
  MAX_OFFSET: 10000,
  MAX_PAGE_NUMBER: 100000,

  // Transaction timeouts
  TRANSACTION_TIMEOUT_MS: 30000,
  STATEMENT_TIMEOUT_MS: 30000,
  QUERY_TIMEOUT_MS: 60000,

  // Connection retry
  CONNECTION_RETRY_ATTEMPTS: 3,
  CONNECTION_RETRY_DELAY_MS: 1000,
} as const;

// ============================================================================
// Rate Limiting Constants - MEDIUM FIX M6
// ============================================================================

/** Rate limiting constants - MEDIUM FIX M6 */
export const RATE_LIMIT = {
  DEFAULT_WINDOW_MS: 60 * 1000, // 1 minute
  DEFAULT_MAX_REQUESTS: 100,

  // Specific endpoints - MEDIUM FIX I5: Add range validation
  CONTENT_CREATE_MAX: 50,
  CONTENT_PUBLISH_MAX: 20,
  PUBLISHING_MAX: 10,
  MEDIA_UPLOAD_MAX: 30,
  AI_GENERATE_MAX: 10,
  EXPORT_LARGE_MAX: 5,

  // Burst limits
  BURST_LIMIT_MULTIPLIER: 2,
  BURST_WINDOW_MS: 1000, // 1 second
} as const;

// ============================================================================
// HTTP Constants - MEDIUM FIX M6
// ============================================================================

/** HTTP-related constants - MEDIUM FIX M6 */
export const HTTP = {
  // Status codes
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,

  // Timeouts - MEDIUM FIX C4: Standardize timeouts across adapters
  REQUEST_TIMEOUT_MS: 30000,
  RESPONSE_TIMEOUT_MS: 60000,
  HEALTH_CHECK_TIMEOUT_MS: 5000,

  // Body limits - MEDIUM FIX I5: Add length validation
  MAX_BODY_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  MAX_JSON_SIZE_BYTES: 5 * 1024 * 1024,  // 5MB
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024, // 100MB
} as const;

// ============================================================================
// Content Constants - MEDIUM FIX M6
// ============================================================================

/** Content-related constants - MEDIUM FIX M6 */
export const CONTENT = {
  // Length limits - MEDIUM FIX I5: Add length validation
  MAX_TITLE_LENGTH: 500,
  MAX_BODY_LENGTH: 50000,
  MAX_EXCERPT_LENGTH: 500,
  MAX_SLUG_LENGTH: 200,
  MIN_SLUG_LENGTH: 1,

  // Count limits
  MAX_TAGS: 10,
  MAX_CATEGORIES: 5,
  MAX_AUTHORS: 5,

  // Scheduling
  MIN_SCHEDULE_MINUTES_AHEAD: 5,
  MAX_SCHEDULE_MONTHS_AHEAD: 12,
} as const;

// ============================================================================
// Job Constants - MEDIUM FIX M6
// ============================================================================

/** Job processing constants - MEDIUM FIX M6 */
export const JOBS = {
  // Timeouts
  DEFAULT_TIMEOUT_MS: 300000, // 5 minutes
  HIGH_PRIORITY_TIMEOUT_MS: 120000, // 2 minutes
  EXPORT_TIMEOUT_MS: 600000, // 10 minutes
  PUBLISHING_TIMEOUT_MS: 300000, // 5 minutes

  // Retry configuration - MEDIUM FIX I5: Add range validation
  DEFAULT_MAX_RETRIES: 3,
  DEFAULT_BACKOFF_MS: 5000,
  MAX_BACKOFF_MS: 300000, // 5 minutes
  BACKOFF_MULTIPLIER: 2,

  // Concurrency
  DEFAULT_CONCURRENCY: 5,
  MAX_CONCURRENCY: 50,

  // Priorities (lower is higher priority) - MEDIUM FIX I8: Add enum validation
  PRIORITY_CRITICAL: 1,
  PRIORITY_HIGH: 25,
  PRIORITY_NORMAL: 50,
  PRIORITY_LOW: 75,
  PRIORITY_BACKGROUND: 100,

  // Batch sizes
  DEFAULT_BATCH_SIZE: 100,
  MAX_BATCH_SIZE: 1000,
} as const;

// ============================================================================
// Cache Constants - MEDIUM FIX M6
// ============================================================================

/** Caching constants - MEDIUM FIX M6 */
export const CACHE = {
  // TTL values
  DEFAULT_TTL_MS: 5 * 60 * 1000, // 5 minutes
  SHORT_TTL_MS: 60 * 1000, // 1 minute
  MEDIUM_TTL_MS: 15 * 60 * 1000, // 15 minutes
  LONG_TTL_MS: 60 * 60 * 1000, // 1 hour
  MAX_TTL_MS: 24 * 60 * 60 * 1000, // 24 hours

  // Size limits - MEDIUM FIX I5: Add range validation
  MAX_KEY_LENGTH: 250,
  MAX_VALUE_SIZE_BYTES: 1024 * 1024, // 1MB
  MAX_LARGE_VALUE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB

  // LRU settings
  DEFAULT_MAX_ENTRIES: 10000,
} as const;

// ============================================================================
// Security Constants - MEDIUM FIX M6
// ============================================================================

/** Security-related constants - MEDIUM FIX M6 */
export const SECURITY = {
  // JWT
  JWT_MIN_KEY_LENGTH: 32,
  JWT_DEFAULT_EXPIRES_IN: '1h',
  JWT_MAX_EXPIRES_IN: '7d',

  // Token revocation
  REVOCATION_TTL_DAYS: 7,

  // Audit
  AUDIT_BUFFER_SIZE: 10000,
  AUDIT_FLUSH_INTERVAL_MS: 5000,

  // Idempotency
  IDEMPOTENCY_KEY_TTL_HOURS: 24,
  IDEMPOTENCY_KEY_MAX_LENGTH: 64,

  // Rate limiting
  MAX_FAILED_LOGINS: 5,
  LOCKOUT_DURATION_MINUTES: 30,

  // Encryption
  BCRYPT_ROUNDS: 12,
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
} as const;

// ============================================================================
// Validation Constants - MEDIUM FIX M6
// ============================================================================

/** Validation-related constants - MEDIUM FIX M6 */
export const VALIDATION = {
  // String lengths - MEDIUM FIX I5: Add length validation
  MAX_EMAIL_LENGTH: 255,
  MAX_URL_LENGTH: 2000,
  MAX_ARRAY_LENGTH: 100,
  MAX_STRING_LENGTH: 10000,
  MAX_TEXT_LENGTH: 100000,

  // UUID
  UUID_LENGTH: 36,
  UUID_REGEX_PATTERN: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',

  // Search
  MAX_SEARCH_QUERY_LENGTH: 200,
  MIN_SEARCH_QUERY_LENGTH: 1,
} as const;

// ============================================================================
// Pagination Constants - MEDIUM FIX M6
// ============================================================================

/** Pagination-related constants - MEDIUM FIX M6 */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 50,
  MIN_LIMIT: 1,
  MAX_LIMIT: 1000,
  MAX_OFFSET: 10000,
} as const;

// ============================================================================
// Circuit Breaker Constants - MEDIUM FIX M6
// ============================================================================

/** Circuit breaker constants - MEDIUM FIX M6 */
export const CIRCUIT_BREAKER = {
  FAILURE_THRESHOLD: 5,
  RESET_TIMEOUT_MS: 30000,
  HALF_OPEN_MAX_CALLS: 3,
  TIMEOUT_MS: 300000,

  // Health check
  HEALTH_CHECK_INTERVAL_MS: 30000,
  HEALTH_CHECK_TIMEOUT_MS: 5000,
} as const;

// ============================================================================
// Retry Constants - MEDIUM FIX M6
// ============================================================================

/** Retry-related constants - MEDIUM FIX M6 */
export const RETRY = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 1000,
  MAX_DELAY_MS: 60000,
  MIN_DELAY_MS: 100,
  BACKOFF_MULTIPLIER: 2,

  // Retryable status codes - MEDIUM FIX E1: Use error codes
  RETRYABLE_STATUS_CODES: [408, 429, 500, 502, 503, 504] as const,

  // Retryable error codes
  RETRYABLE_ERROR_CODES: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'] as const,
} as const;

// ============================================================================
// Resource Limits - MEDIUM FIX R5: Add resource limits
// ============================================================================

/** Resource limit constants - MEDIUM FIX R5 */
export const RESOURCE_LIMITS = {
  // Memory (in MB)
  DEFAULT_MAX_MEMORY_MB: 512,
  WARNING_MEMORY_THRESHOLD: 0.8,
  CRITICAL_MEMORY_THRESHOLD: 0.9,

  // Connections
  MAX_DB_CONNECTIONS: 20,
  MAX_CONCURRENT_REQUESTS: 100,

  // Queue depth - MEDIUM FIX R6: Add backpressure handling
  MAX_QUEUE_DEPTH: 1000,
  BACKPRESSURE_THRESHOLD: 0.8,

  // File descriptors
  MAX_OPEN_FILES: 10000,

  // Payload sizes - MEDIUM FIX I5: Add length validation
  MAX_PAYLOAD_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  MAX_FILE_UPLOAD_SIZE_BYTES: 100 * 1024 * 1024, // 100MB
} as const;

// ============================================================================
// Signal Handling Constants - MEDIUM FIX R4: Add signal handling
// ============================================================================

/** Signal handling constants - MEDIUM FIX R4 */
export const SIGNALS = {
  // Shutdown signals
  SHUTDOWN_SIGNALS: ['SIGTERM', 'SIGINT', 'SIGUSR2'] as const,

  // Graceful shutdown timeout
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: 30000,

  // Force shutdown timeout
  FORCE_SHUTDOWN_TIMEOUT_MS: 10000,
} as const;

// ============================================================================
// Enum Values - MEDIUM FIX I8: Add enum validation
// ============================================================================

/** Content status enum values - MEDIUM FIX I8 */
export const CONTENT_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
  SCHEDULED: 'scheduled',
} as const;

/** Content type enum values - MEDIUM FIX I8 */
export const CONTENT_TYPE = {
  ARTICLE: 'article',
  VIDEO: 'video',
  PODCAST: 'podcast',
  SOCIAL: 'social',
} as const;

/** Job status enum values - MEDIUM FIX I8 */
export const JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

/** Publishing platform enum values - MEDIUM FIX I8 */
export const PUBLISHING_PLATFORM = {
  WORDPRESS: 'wordpress',
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  TWITTER: 'twitter',
  LINKEDIN: 'linkedin',
  TIKTOK: 'tiktok',
  YOUTUBE: 'youtube',
  PINTEREST: 'pinterest',
} as const;

// ============================================================================
// Default Configuration Object - MEDIUM FIX C3
// ============================================================================

/**
* Complete default configuration object
* MEDIUM FIX C3: Remove hardcoded defaults, make configurable
* MEDIUM FIX C6: Move hardcoded values to configuration
*/
export const DEFAULT_CONFIG = {
  time: TIME,
  timeSeconds: TIME_SECONDS,
  db: DB,
  rateLimit: RATE_LIMIT,
  http: HTTP,
  content: CONTENT,
  jobs: JOBS,
  cache: CACHE,
  security: SECURITY,
  validation: VALIDATION,
  pagination: PAGINATION,
  circuitBreaker: CIRCUIT_BREAKER,
  retry: RETRY,
  resourceLimits: RESOURCE_LIMITS,
  signals: SIGNALS,
  enums: {
    contentStatus: CONTENT_STATUS,
    contentType: CONTENT_TYPE,
    jobStatus: JOB_STATUS,
    publishingPlatform: PUBLISHING_PLATFORM,
  },
} as const;

export default DEFAULT_CONFIG;
