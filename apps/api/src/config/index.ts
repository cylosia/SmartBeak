/**
 * Configuration Barrel Export — Re-export Shim
 *
 * All configuration is centralized in @config (packages/config/).
 * This file re-exports for backward compatibility with existing local imports.
 *
 * @deprecated Import directly from '@config' for new code.
 */

// ============================================================================
// Re-exports from utils/config shim (preserves local compatibility aliases)
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
// Re-exports from centralized @config package
// ============================================================================

export {
  paginationConfig,
  cacheConfig,
  redisConfig,
  jobConfig,
  contentIdeaConfig,
  exportConfig,
  publishingConfig,
  dbConfig,
  abuseGuardConfig,
  retryConfig,
  circuitBreakerConfig,
  timeoutConfig,
  getBillingConfig,
} from '@config';
