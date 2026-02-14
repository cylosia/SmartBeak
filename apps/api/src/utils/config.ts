/**
 * API Utils Configuration — Re-export Shim
 *
 * This file re-exports from the centralized @config package.
 * Local types and compatibility aliases are preserved for existing consumers.
 *
 * @deprecated Import directly from '@config' for new code.
 */

// ============================================================================
// Re-exports from centralized config
// ============================================================================

export {
  API_VERSIONS,
  API_BASE_URLS,
  buildApiUrl,
  getMailchimpBaseUrl,
  getFacebookGraphUrl,
  type ServiceName,
  type QueryParams,
} from '@config';

export type ApiBaseUrls = typeof import('@config').API_BASE_URLS;

// ============================================================================
// Timeout Configuration (compatibility alias)
// ============================================================================

import { timeoutConfig } from '@config';

export type TimeoutDuration = 'short' | 'medium' | 'long' | 'extended';

export const DEFAULT_TIMEOUTS = {
  ...timeoutConfig,
  /** Alias for maxBounded — used by existing adapters */
  max: timeoutConfig.maxBounded,
} as const;

// ============================================================================
// Retry Configuration (compatibility wrapper)
// ============================================================================

import { retryConfig } from '@config';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  minDelayMs: number;
  retryableStatuses: number[];
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: retryConfig.maxRetries,
  baseDelayMs: retryConfig.baseDelayMs,
  maxDelayMs: retryConfig.maxDelayMs,
  minDelayMs: retryConfig.minDelayMs,
  retryableStatuses: retryConfig.retryableStatuses as number[],
  backoffMultiplier: retryConfig.backoffMultiplier,
} as const;

// ============================================================================
// Circuit Breaker Configuration (compatibility wrapper)
// ============================================================================

import { circuitBreakerConfig } from '@config';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: circuitBreakerConfig.failureThreshold,
  resetTimeoutMs: circuitBreakerConfig.resetTimeoutMs,
  halfOpenMaxAttempts: circuitBreakerConfig.halfOpenMaxCalls,
} as const;

// ============================================================================
// Rate Limiting Configuration
// ============================================================================

export interface RateLimitConfig {
  defaultRequestsPerSecond?: number | undefined;
  defaultRequestsPerMinute?: number | undefined;
  defaultRequestsPerHour?: number | undefined;
  burstAllowance?: number | undefined;
  tokensPerInterval?: number | undefined;
  intervalSeconds?: number | undefined;
  burstSize?: number | undefined;
  maxRetries?: number | undefined;
  retryDelayMs?: number | undefined;
  failureThreshold?: number | undefined;
  cooldownSeconds?: number | undefined;
}

export const RATE_LIMIT_CONFIG: RateLimitConfig = {
  defaultRequestsPerSecond: 10,
  defaultRequestsPerMinute: 100,
  defaultRequestsPerHour: 1000,
  burstAllowance: 5,
} as const;
