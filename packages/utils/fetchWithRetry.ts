import { createHash } from 'crypto';

import { LRUCache } from './lruCache';

import { getLogger } from '@kernel/logger';
import { sleep } from '@kernel/retry';


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

  // P2 FIX: Store the timer reference and clear it when writes complete before
  // the timeout fires. Without clearTimeout, every successful early completion
  // leaves a dangling timer that blocks Node.js graceful shutdown for up to
  // timeoutMs (default 30s), defeating the purpose of "graceful shutdown".
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Cache write wait timeout')), timeoutMs);
  });

  const allWritesPromise = Promise.allSettled([...pendingCacheWrites]).then(() => {
    logger.debug('All pending cache writes completed');
  });

  try {
    await Promise.race([allWritesPromise, timeoutPromise]);
  } catch (err) {
    logger.warn(`Timeout waiting for pending cache writes after ${timeoutMs}ms`);
  } finally {
    clearTimeout(timeoutId);
  }
}

// P2-7 FIX: Maximum response size to cache (1MB).
// Without this, a single large response (e.g., export file) cached as
// ArrayBuffer causes unbounded memory spikes.
const MAX_CACHEABLE_BODY_SIZE = 1024 * 1024; // 1MB

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
    // P2-7 FIX: Skip caching if Content-Length indicates a large response.
    // F-6 FIX: parseInt returns NaN for non-numeric headers (e.g. "chunked").
    // NaN > MAX_CACHEABLE_BODY_SIZE is false, silently bypassing the cap and
    // allowing an unbounded response body to be buffered into the in-process cache.
    // Explicitly check isNaN so the guard works correctly for malformed headers.
    const contentLength = clonedResponse.headers.get('content-length');
    if (contentLength) {
      const parsedLength = parseInt(contentLength, 10);
      if (!isNaN(parsedLength) && parsedLength > MAX_CACHEABLE_BODY_SIZE) {
        logger.debug(`Skipping cache for large response (${parsedLength} bytes)`);
        return;
      }
    }

    // P2 FIX: Store timer reference and clear in finally to prevent dangling
    // timers when arrayBuffer() resolves before the timeout.
    let cacheTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      cacheTimeoutId = setTimeout(() => reject(new Error('Cache write timeout')), timeoutMs);
    });

    let body: ArrayBuffer;
    try {
      body = await Promise.race([clonedResponse.arrayBuffer(), timeoutPromise]);
    } finally {
      clearTimeout(cacheTimeoutId);
    }

    // P2-7 FIX: Also check actual body size (Content-Length may be absent)
    if (body.byteLength > MAX_CACHEABLE_BODY_SIZE) {
      logger.debug(`Skipping cache for large response body (${body.byteLength} bytes)`);
      return;
    }

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
  public readonly retryAfterMs: number | undefined;
  constructor(
  message: string,
  public readonly status?: number,
  public readonly code?: string,
  retryAfterMs?: number | undefined
  ) {
  super(message);
  this.name = 'RetryableError';
  this.retryAfterMs = retryAfterMs;
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
  const errorCodes = options.retryableErrorCodes ?? DEFAULT_RETRY_OPTIONS.retryableErrorCodes;
  if (code && errorCodes.includes(code)) {
    return true;
  }

  // Check error message for retryable patterns
  const message = error.message.toLowerCase();
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
  return Math.max(0, Math.floor(cappedDelay + jitter));
}

// sleep() is now imported from @kernel/retry

/**
* Generate cache key for request
* P0-FIX: Include Authorization header to prevent cross-user cache poisoning
* P0-4 FIX: Hash the auth token instead of storing it in plain text.
* Previously, raw JWT/API keys were embedded in cache key strings, meaning
* any heap dump, debug log, or error serialization would expose credentials.
* P2-FIX: Normalize body representation for stable cache keys
*/
function generateCacheKey(url: string, options: RequestInit): string {
  const method = options.method || 'GET';
  const body = typeof options.body === 'string' ? options.body : '';
  // P0-FIX: Include auth header in cache key to prevent cross-user data leakage
  const headers = options.headers;
  let rawAuth = '';
  if (headers) {
    if (headers instanceof Headers) {
      rawAuth = headers.get('authorization') || headers.get('cookie') || '';
    } else if (Array.isArray(headers)) {
      const authEntry = headers.find(([k]) => k.toLowerCase() === 'authorization' || k.toLowerCase() === 'cookie');
      // P1 FIX: authEntry[1] can be undefined if a header tuple has only one element
      // (malformed but valid JS). Undefined produces an empty auth segment, collapsing
      // cache keys across different auth contexts → cross-user cache poisoning.
      rawAuth = authEntry != null && authEntry.length > 1 ? (authEntry[1] ?? '') : '';
    } else {
      // Normalise to lowercase so 'Authorization' and 'authorization' hash identically
      const normHeaders: Record<string, string> = {};
      Object.entries(headers as Record<string, string>).forEach(([k, v]) => {
        normHeaders[k.toLowerCase()] = v;
      });
      rawAuth = normHeaders['authorization'] || normHeaders['cookie'] || '';
    }
  }
  // P0-4 FIX: Use the FULL SHA-256 digest (64 chars / 256 bits).
  // The previous .slice(0,16) truncated to 64 bits, making birthday collisions
  // reachable in production at scale and leaking one user's response to another.
  const authKey = rawAuth
    ? createHash('sha256').update(rawAuth).digest('hex')
    : '';
  return `${method}:${url}:${body}:${authKey}`;
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

  // S-1 FIX: Use per-attempt AbortController so timeout on one attempt
  // doesn't abort subsequent retries
  const originalSignal = fetchOptions.signal;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt++) {
      // Check if caller has already aborted before starting a new attempt
      if (originalSignal?.aborted) {
        throw new Error('Request aborted by caller');
      }

      const attemptController = new AbortController();
      let attemptTimeoutId: NodeJS.Timeout | null = null;

      if (timeout) {
        attemptTimeoutId = setTimeout(() => attemptController.abort(), timeout);
      }

      // Forward caller's abort signal to this attempt's controller
      let abortListener: (() => void) | null = null;
      if (originalSignal) {
        abortListener = () => attemptController.abort();
        originalSignal.addEventListener('abort', abortListener);
      }

      try {
        const response = await fetch(url, {
          ...fetchOptions,
          signal: attemptController.signal,
        });

        // Check if response status is retryable.
        // P2 FIX: Use optional chaining + nullish coalescing. If a caller passes
        // `retry: { retryableStatuses: undefined }`, the object spread produces
        // `retryOptions.retryableStatuses === undefined`, causing `.includes()` to
        // throw TypeError. Fall back to the DEFAULT list when undefined.
        const effectiveStatuses = retryOptions.retryableStatuses ?? DEFAULT_RETRY_OPTIONS.retryableStatuses;
        if (!response.ok && effectiveStatuses.includes(response.status)) {
          const retryAfter = response.headers.get('retry-after');
          let retryAfterMs: number | undefined;

          if (retryAfter) {
            // Parse Retry-After header (seconds or HTTP date)
            const seconds = parseInt(retryAfter, 10);
            retryAfterMs = isNaN(seconds)
              ? Math.max(0, new Date(retryAfter).getTime() - Date.now())
              : seconds * 1000;
          }

          throw new RetryableError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            undefined,
            retryAfterMs
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

        // Use server-specified Retry-After if available, otherwise exponential backoff
        const serverRetryAfter = lastError instanceof RetryableError ? lastError.retryAfterMs : undefined;
        const delayMs = serverRetryAfter ?? calculateDelay(attempt, retryOptions.baseDelayMs, retryOptions.maxDelayMs);

        logger.warn(`Retry attempt ${attempt + 1}/${retryOptions.maxRetries} after ${delayMs}ms`, { delayMs });

        if (retryOptions.onRetry) {
          retryOptions.onRetry(attempt + 1, lastError, delayMs);
        }

        await sleep(delayMs);
      } finally {
        // S-1 FIX: Clean up per-attempt timeout and abort listener
        if (attemptTimeoutId) {
          clearTimeout(attemptTimeoutId);
        }
        if (originalSignal && abortListener) {
          originalSignal.removeEventListener('abort', abortListener);
        }
      }
    }

  throw lastError || new Error(`Fetch failed after ${retryOptions.maxRetries} retries`);
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
  // P1-6 FIX: Call fn (the wrapped function) inside fetchWithRetry so that
  // any custom logic in fn (auth injection, logging, tracing) is preserved.
  // Previously fn was ignored and fetchWithRetry was called directly.
  return (async (url: string, options?: RequestInit & { retry?: RetryOptions }): Promise<Response> => {
    const mergedOptions = {
      ...options,
      retry: { ...defaultOptions, ...options?.retry },
    };
    let attempt = 0;
    const retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...mergedOptions.retry };
    let lastError: Error | undefined;
    while (attempt <= retryOptions.maxRetries) {
      try {
        return await fn(url, mergedOptions);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt >= retryOptions.maxRetries || !isRetryableError(error, retryOptions)) {
          throw lastError;
        }
        const delayMs = calculateDelay(attempt, retryOptions.baseDelayMs, retryOptions.maxDelayMs);
        logger.warn(`makeRetryable: retry ${attempt + 1}/${retryOptions.maxRetries}`, { delayMs });
        await sleep(delayMs);
        attempt++;
      }
    }
    throw lastError ?? new Error('makeRetryable: exhausted retries');
  }) as T;
}

export { DEFAULT_RETRY_OPTIONS };
