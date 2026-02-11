import { LRUCache } from './lruCache';

﻿import { getLogger } from '@kernel/logger';


/**
* Fetch with Retry Utility
* P1-FIX: Centralized retry logic with exponential backoff for all external API calls
*/

const logger = getLogger('fetch-retry');

// P1-FIX: Response cache to avoid redundant API calls with bounded size
const DEFAULT_CACHE_SIZE = 100;
const DEFAULT_CACHE_TTL_MS = 5000; // 5 seconds default TTL for API responses

export interface CachedResponse {
  body: ArrayBuffer;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  timestamp: number;
}

// P1-FIX: Bounded response cache to prevent memory leaks
const responseCache = new LRUCache<string, CachedResponse>({
  maxSize: DEFAULT_CACHE_SIZE,
  ttlMs: DEFAULT_CACHE_TTL_MS,
});

// P0-FIX: Track pending cache writes to prevent unhandled rejections and enable graceful shutdown
const pendingCacheWrites = new Set<Promise<void>>();
const DEFAULT_CACHE_WRITE_TIMEOUT_MS = 5000; // 5 second timeout for cache writes

/**
 * Wait for all pending cache writes to complete
 * P0-FIX: Use this for graceful shutdown to ensure all cached responses are persisted
 * @param timeoutMs - Maximum time to wait for pending writes (default: 30000ms)
 * @returns Promise that resolves when all pending writes complete or timeout
 */
export async function waitForPendingCacheWrites(timeoutMs = 30000): Promise<void> {
  if (pendingCacheWrites.size === 0) {
    return;
  }

  logger.debug(`Waiting for ${pendingCacheWrites.size} pending cache writes...`);

  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error('Cache write wait timeout')), timeoutMs);
  });

  const allWritesPromise = Promise.allSettled(Array.from(pendingCacheWrites)).then(() => {
    logger.debug('All pending cache writes completed');
  });

  try {
    await Promise.race([allWritesPromise, timeoutPromise]);
  } catch (err) {
    logger.warn(`Timeout waiting for pending cache writes after ${timeoutMs}ms`);
  }
}

/**
 * Execute cache write with timeout and proper error handling
 * P0-FIX: Prevents floating promises and unhandled rejections
 */
function executeCacheWrite(
  cacheKey: string,
  clonedResponse: Response,
  timeoutMs: number
): void {
  const cacheWritePromise = (async (): Promise<void> => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Cache write timeout')), timeoutMs);
    });

    const body = await Promise.race([clonedResponse.arrayBuffer(), timeoutPromise]);
    const headers: Record<string, string> = {};
    clonedResponse.headers.forEach((value, key) => {
      headers[key] = value;
    });

    responseCache.set(cacheKey, {
      body,
      headers,
      status: clonedResponse.status,
      statusText: clonedResponse.statusText,
      timestamp: Date.now(),
    });
  })();

  // Track the promise and clean up when done
  pendingCacheWrites.add(cacheWritePromise);
  cacheWritePromise
    .catch((err) => {
      logger.debug(`Failed to cache response: ${err instanceof Error ? err.message : String(err)}`);
    })
    .finally(() => {
      pendingCacheWrites.delete(cacheWritePromise);
    });
}

// P1-FIX: Retry configuration
const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  retryableErrorCodes: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNABORTED'],
};

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryableStatuses?: number[];
  retryableErrorCodes?: string[];
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
  /** P1-FIX: Cache TTL in milliseconds (0 = no caching) */
  cacheTtlMs?: number;
}

// P1-FIX: Custom error for retryable failures
export class RetryableError extends Error {
  constructor(
  message: string,
  public readonly status?: number,
  public readonly code?: string
  ) {
  super(message);
  this.name = 'RetryableError';
  }
}

// P1-FIX: Check if error is retryable
function isRetryableError(error: unknown, options: RetryOptions): boolean {
  // Check for HTTP status - P1-FIX: Add proper existence check instead of non-null assertion
  if (error instanceof RetryableError && error.status !== undefined) {
    const statuses = options.retryableStatuses ?? DEFAULT_RETRY_OPTIONS.retryableStatuses;
    if (statuses !== undefined && statuses.includes(error.status)) {
      return true;
    }
  }

  // Check for network error codes
  if (error instanceof Error) {
  const code = (error as Error & { code?: string }).code;
  if (code && options.retryableErrorCodes!.includes(code)) {
    return true;
  }

  // Check error message for retryable patterns
  const message = error["message"].toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('abort')
  );
  }

  return false;
}

// P1-FIX: Calculate delay with exponential backoff and jitter
function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  // Add jitter (±25%) to prevent thundering herd
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.floor(cappedDelay + jitter);
}

// P1-FIX: Sleep utility
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
* Generate cache key for request
* P1-FIX: Create unique key based on URL and relevant options
*/
function generateCacheKey(url: string, options: RequestInit): string {
  const method = options.method || 'GET';
  const body = options.body ? JSON.stringify(options.body) : '';
  return `${method}:${url}:${body}`;
}

/**
* Create cached Response object
* P1-FIX: Reconstruct Response from cached data
*/
function createCachedResponse(cached: CachedResponse): Response {
  return new Response(cached.body, {
  status: cached.status,
  statusText: cached.statusText,
  headers: cached.headers,
  });
}

/**
* Fetch with automatic retry and exponential backoff
* P1-FIX: Centralized retry logic for all external API calls with response caching
*
* @param url - URL to fetch
* @param options - Fetch options with optional retry configuration
* @returns Fetch response
* @throws Error if all retries are exhausted
*/
export async function fetchWithRetry(
  url: string,
  options: RequestInit & { retry?: RetryOptions; timeout?: number } = {}
): Promise<Response> {
  const { retry, timeout, ...fetchOptions } = options;
  const retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...retry };

  // P1-FIX: Check cache for GET requests (idempotent)
  const cacheKey = generateCacheKey(url, fetchOptions);
  const cacheTtl = retryOptions.cacheTtlMs ?? 0;

  if (cacheTtl > 0 && (!fetchOptions.method || fetchOptions.method === 'GET')) {
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < cacheTtl) {
    logger.debug(`Cache hit for ${url}`);
    return createCachedResponse(cached);
  }
  }

  // P1-FIX: AbortController for timeout with proper cleanup in finally block
  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | null = null;

  if (timeout) {
    timeoutId = setTimeout(() => controller.abort(), timeout);
  }

  // Merge abort signals if one is provided
  const originalSignal = fetchOptions.signal;
  let abortListener: (() => void) | null = null;

  if (originalSignal) {
    abortListener = () => controller.abort();
    originalSignal.addEventListener('abort', abortListener);
  }

  let lastError: Error | undefined;

  try {
    for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
        });

        // Check if response status is retryable
        if (!response.ok && retryOptions.retryableStatuses.includes(response.status)) {
          const retryAfter = response.headers.get('retry-after');
          let delayMs: number;

          if (retryAfter) {
            // Parse Retry-After header (seconds or HTTP date)
            const seconds = parseInt(retryAfter, 10);
            delayMs = isNaN(seconds)
              ? new Date(retryAfter).getTime() - Date.now()
              : seconds * 1000;
          } else {
            delayMs = calculateDelay(attempt, retryOptions.baseDelayMs, retryOptions.maxDelayMs);
          }

          throw new RetryableError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status
          );
        }

        // P1-FIX: Cache successful GET responses with proper error handling
        // P0-FIX: Use executeCacheWrite to prevent floating promises and unhandled rejections
        if (cacheTtl > 0 && response.ok && (!fetchOptions.method || fetchOptions.method === 'GET')) {
          const clonedResponse = response.clone();
          executeCacheWrite(cacheKey, clonedResponse, DEFAULT_CACHE_WRITE_TIMEOUT_MS);
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on the last attempt
        if (attempt >= retryOptions.maxRetries) {
          break;
        }

        // Check if error is retryable
        if (!isRetryableError(error, retryOptions)) {
          throw error;
        }

        // Calculate delay with exponential backoff
        const delayMs = calculateDelay(attempt, retryOptions.baseDelayMs, retryOptions.maxDelayMs);

        logger.warn(`Retry attempt ${attempt + 1}/${retryOptions.maxRetries} for ${url} after ${delayMs}ms: ${lastError["message"]}`);

        if (retryOptions.onRetry) {
          retryOptions.onRetry(attempt + 1, lastError, delayMs);
        }

        await sleep(delayMs);
      }
    }

    throw lastError || new Error(`Fetch failed after ${retryOptions.maxRetries} retries`);
  } finally {
    // P1-FIX: Always cleanup timeout and event listeners
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (originalSignal && abortListener) {
      originalSignal.removeEventListener('abort', abortListener);
    }
  }
}

/**
* Create a retryable version of any fetch-based function
* P1-FIX: Higher-order function for making any fetch call retryable
* P3-FIX: Replaced 'any' with proper types
*/
export function makeRetryable<T extends (url: string, options?: RequestInit) => Promise<Response>>(
  fn: T,
  defaultOptions?: RetryOptions
): T {
  return (async (url: string, options?: RequestInit & { retry?: RetryOptions }): Promise<Response> => {
  return fetchWithRetry(url, {
    ...options,
    retry: { ...defaultOptions, ...options?.retry },
  });
  }) as T;
}

export { DEFAULT_RETRY_OPTIONS };
