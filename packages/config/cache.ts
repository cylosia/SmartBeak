/**
 * Cache Configuration
 * 
 * Cache-related settings for Redis and in-memory caching.
 */

import { parseIntEnv } from './env';

/** Named constants for cache configuration */
const CACHE_CONSTANTS = {
  DEFAULT_TTL_SECONDS: 300, // 5 minutes
  DEFAULT_MAX_KEY_LENGTH: 250,
  DEFAULT_VERSION: 'v2',
  DEFAULT_PREFIX: 'cache',
  ABORT_CONTROLLER_MAX: 10000,
  ABORT_CONTROLLER_TTL_MS: 3600000, // 1 hour
  CIRCUIT_BREAKER_MAX: 100,
  CIRCUIT_BREAKER_TTL_MS: 3600000, // 1 hour
} as const;

export const cacheConfig = {
  /** Default TTL in seconds */
  defaultTtlSeconds: parseIntEnv('CACHE_DEFAULT_TTL_SECONDS', CACHE_CONSTANTS.DEFAULT_TTL_SECONDS),

  /** Maximum key length */
  maxKeyLength: parseIntEnv('CACHE_MAX_KEY_LENGTH', CACHE_CONSTANTS.DEFAULT_MAX_KEY_LENGTH),

  /** Cache version for invalidation */
  version: process.env['CACHE_VERSION'] || CACHE_CONSTANTS.DEFAULT_VERSION,

  /** Default cache prefix */
  prefix: process.env['CACHE_PREFIX'] || CACHE_CONSTANTS.DEFAULT_PREFIX,

  /** LRU cache max size for abort controllers */
  abortControllerCacheMax: parseIntEnv('CACHE_ABORT_CONTROLLER_MAX', CACHE_CONSTANTS.ABORT_CONTROLLER_MAX),

  /** LRU cache TTL for abort controllers in milliseconds */
  abortControllerCacheTtlMs: parseIntEnv('CACHE_ABORT_CONTROLLER_TTL_MS', CACHE_CONSTANTS.ABORT_CONTROLLER_TTL_MS),

  /** Circuit breaker cache max size */
  circuitBreakerCacheMax: parseIntEnv('CACHE_CIRCUIT_BREAKER_MAX', CACHE_CONSTANTS.CIRCUIT_BREAKER_MAX),

  /** Circuit breaker cache TTL in milliseconds */
  circuitBreakerCacheTtlMs: parseIntEnv('CACHE_CIRCUIT_BREAKER_TTL_MS', CACHE_CONSTANTS.CIRCUIT_BREAKER_TTL_MS),
} as const;

/**
 * Redis configuration with connection settings
 */
export const redisConfig = {
  ...cacheConfig,
  /** Initial reconnection delay in milliseconds */
  initialReconnectDelayMs: parseIntEnv('REDIS_INITIAL_RECONNECT_DELAY_MS', 1000),
  /** Maximum reconnection delay in milliseconds */
  maxReconnectDelayMs: parseIntEnv('REDIS_MAX_RECONNECT_DELAY_MS', 30000),
  /** Maximum retries per request */
  maxRetriesPerRequest: parseIntEnv('REDIS_MAX_RETRIES_PER_REQUEST', 3),
  /** Connection timeout in milliseconds */
  connectTimeoutMs: parseIntEnv('REDIS_CONNECT_TIMEOUT_MS', 10000),
  /** Command timeout in milliseconds */
  commandTimeoutMs: parseIntEnv('REDIS_COMMAND_TIMEOUT_MS', 5000),
  /** Maximum reconnection attempts */
  maxReconnectAttempts: parseIntEnv('REDIS_MAX_RECONNECT_ATTEMPTS', 10),
  /** Keep alive interval in milliseconds */
  keepAliveMs: parseIntEnv('REDIS_KEEP_ALIVE_MS', 30000),
  /** Wait for connection timeout in milliseconds */
  waitForConnectionTimeoutMs: parseIntEnv('REDIS_WAIT_FOR_CONNECTION_MS', 30000),
} as const;
