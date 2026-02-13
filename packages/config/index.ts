/**
 * Shared Configuration Package
 * 
 * Environment variable validation and configuration utilities.
 * This package provides centralized configuration management to prevent
 * cross-boundary imports between apps.
 * 
 * @example
 * ```typescript
 * import { apiConfig, validateEnv, isFeatureEnabled } from '@config';
 * 
 * // Validate at startup
 * validateEnv();
 * 
 * // Use configuration
 * const timeout = apiConfig.timeoutMs;
 * 
 * // Check feature flags
 * if (isFeatureEnabled('enableAI')) {
 *   // AI features enabled
 * }
 * ```
 * 
 * @module @config
 */

// ============================================================================
// Environment Utilities
// ============================================================================
export {
  getEnvVar,
  isPlaceholder,
  parseIntEnv,
  requireIntEnv,
  parseFloatEnv,
  parseBoolEnv,
  requireBoolEnv,
  parseArrayEnv,
  parseJSONEnv,
} from './env';

// ============================================================================
// Validation
// ============================================================================
export {
  REQUIRED_ENV_VARS,
  OPTIONAL_ENV_VARS,
  type RequiredEnvVar,
  type OptionalEnvVar,
  type ValidationResult,
  validateConfig,
  validateEnv,
  validateStartup,
  requireEnv,
  getOptionalEnv,
  getEnv,
  getEnvWithDefault,
} from './validation';

// ============================================================================
// API Configuration
// ============================================================================
export {
  apiConfig,
  cdnConfig,
  buildApiUrl,
  getMailchimpBaseUrl,
  getFacebookGraphUrl,
  API_VERSIONS,
  API_BASE_URLS,
  type ServiceName,
  type QueryParams,
} from './api';

// ============================================================================
// Environment Validation Schema
// ============================================================================
export { envSchema, type EnvConfig } from './schema';

// ============================================================================
// Secrets Management
// ============================================================================
export {
  SECRET_MANIFEST,
  getSecretsForFeature,
  getRequiredSecretCategories,
  validateSecretStrength,
  type SecretCategory,
  type SecretCategoryName,
} from './secrets';

// ============================================================================
// Security Configuration
// ============================================================================
export { securityConfig, abuseGuardConfig } from './security';

// ============================================================================
// Security Headers (CSP, HSTS, Cross-Origin, etc.)
// ============================================================================
export {
  BASE_SECURITY_HEADERS,
  CSP_API,
  buildWebAppCsp,
  CSP_THEMES,
  PERMISSIONS_POLICY_WEB_APP,
  PERMISSIONS_POLICY_API,
  PERMISSIONS_POLICY_THEMES,
} from './headers';

// ============================================================================
// Cache Configuration
// ============================================================================
export { cacheConfig, redisConfig } from './cache';

// ============================================================================
// Timeout Configuration
// ============================================================================
export { timeoutConfig, DEFAULT_TIMEOUTS } from './timeouts';

// ============================================================================
// Retry Configuration
// ============================================================================
export { retryConfig } from './retry';

// ============================================================================
// Circuit Breaker Configuration
// ============================================================================
export { circuitBreakerConfig, circuitBreakerConfig as DEFAULT_CIRCUIT_BREAKER_CONFIG } from './circuitBreaker';

// ============================================================================
// Job Queue Configuration
// ============================================================================
export { jobConfig, contentIdeaConfig, exportConfig, publishingConfig } from './jobs';

// ============================================================================
// Database Configuration
// ============================================================================
export { dbConfig } from './database';

// ============================================================================
// Pagination Configuration
// ============================================================================
export { paginationConfig } from './pagination';

// ============================================================================
// Feature Flags
// ============================================================================
export { featureFlags, isFeatureEnabled, getEnabledFeatures, validateFeatureFlags } from './features';

// ============================================================================
// Environment
// ============================================================================
export {
  isProduction,
  isDevelopment,
  isTest,
  envConfig,
} from './environment';

// ============================================================================
// Billing
// ============================================================================
export {
  billingConfig,
  getBillingConfig,
  getStripeConfig,
} from './billing';

// ============================================================================
// Resource Limits
// ============================================================================
export { resourceLimits } from './limits';

// ============================================================================
// Composite Config (convenience export)
// ============================================================================
import { apiConfig, cdnConfig } from './api';
import { securityConfig, abuseGuardConfig } from './security';
import { cacheConfig, redisConfig } from './cache';
import { timeoutConfig } from './timeouts';
import { retryConfig } from './retry';
import { circuitBreakerConfig } from './circuitBreaker';
import { jobConfig, contentIdeaConfig, exportConfig, publishingConfig } from './jobs';
import { dbConfig } from './database';
import { paginationConfig } from './pagination';
import { featureFlags } from './features';
import { envConfig } from './environment';
import { billingConfig } from './billing';
import { resourceLimits } from './limits';

/**
 * Composite configuration object containing all config sections.
 * @deprecated Import individual configs for tree-shaking benefits
 */
export const config = {
  api: apiConfig,
  cdn: cdnConfig,
  security: securityConfig,
  cache: cacheConfig,
  timeout: timeoutConfig,
  retry: retryConfig,
  circuitBreaker: circuitBreakerConfig,
  job: jobConfig,
  db: dbConfig,
  pagination: paginationConfig,
  featureFlags,
  env: envConfig,
  billing: billingConfig,
  resourceLimits,
  redis: redisConfig,
  contentIdea: contentIdeaConfig,
  publishing: publishingConfig,
  export: exportConfig,
  abuseGuard: abuseGuardConfig,
} as const;

export default config;
