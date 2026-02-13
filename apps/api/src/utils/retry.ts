import { retryConfig } from '@config';

/**
* Retry utilities with exponential backoff
*
* Provides retry logic with jittered exponential backoff,
* retry-after header parsing, and status code checking.
*/

// ============================================================================
// Type Definitions
// ============================================================================

/**
* Options for retry operations
*/
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Base delay in milliseconds */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds */
  maxDelayMs?: number;
  /** HTTP statuses that should trigger a retry */
  retryableStatuses?: number[];
  /** Callback invoked on each retry */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
  /** Custom function to determine if error is retryable */
  shouldRetry?: (error: Error) => boolean;
}

/**
* Options for jittered backoff
*/
export interface JitteredBackoffOptions {
  /** Base milliseconds */
  baseMs?: number;
  /** Maximum milliseconds */
  maxMs?: number;
}

// ============================================================================
// Backoff Functions
// ============================================================================

/**
* Calculate jittered backoff delay
* @param attempt - Current attempt number
* @param options - Backoff options
* @returns Delay in milliseconds
*/

export function jitteredBackoff(attempt: number, options: JitteredBackoffOptions = {}): number {
  const { baseMs = retryConfig.baseDelayMs, maxMs = retryConfig.maxDelayMs } = options;
  const exponentialDelay = baseMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxMs);
  const jitter = Math.random() * cappedDelay;
  return Math.floor(jitter);
}

/**
* Check if status code is retryable
* @param status - HTTP status code
* @param retryableStatuses - List of retryable statuses
* @returns Whether status is retryable
*/
export function isRetryableStatus(status: number, retryableStatuses: number[] = [...retryConfig.retryableStatuses]): boolean {
  return retryableStatuses.includes(status);
}

/**
* Parse Retry-After header value
* @param headerValue - Header value string
* @returns Delay in milliseconds
*/
export function parseRetryAfter(headerValue: string | null): number {
  if (!headerValue) return 0;

  // Try parsing as seconds first
  const seconds = parseInt(headerValue, 10);
  if (!isNaN(seconds)) {
  return seconds * 1000; // Convert to milliseconds
  }

  // Try parsing as HTTP date
  const date = new Date(headerValue);
  if (!isNaN(date.getTime())) {
  return Math.max(0, date.getTime() - Date.now());
  }

  return 0;
}

// ============================================================================
// Retry Functions
// ============================================================================

/**
* Execute a function with retry logic
* @param fn - Function to execute
* @param options - Retry options
* @returns Function result
* @throws Error if all retries are exhausted
*/
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
  maxRetries = retryConfig.maxRetries,
  baseDelayMs = retryConfig.baseDelayMs,
  maxDelayMs = retryConfig.maxDelayMs,
  retryableStatuses = [...retryConfig.retryableStatuses],
  onRetry: _onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
  try {
    return await fn();
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error));

    // Don't retry on the last attempt
    if (attempt >= maxRetries) {
    throw lastError;
    }

    // Check if error has a status property (from HTTP responses)
    const status = (error as { status?: number }).status;

    // If status is present and not retryable, throw immediately
    if (status !== undefined && !isRetryableStatus(status, retryableStatuses)) {
    throw lastError;
    }

    // Check for Retry-After header (rate limiting)
    const retryAfter = (error as { retryAfter?: string }).retryAfter;
    let delayMs = retryAfter
    ? parseRetryAfter(retryAfter)
    : jitteredBackoff(attempt, { baseMs: baseDelayMs, maxMs: maxDelayMs });

    // Ensure minimum delay
    delayMs = Math.max(delayMs, retryConfig.minDelayMs);

    if (options.onRetry) {
    options.onRetry(attempt + 1, lastError, delayMs);
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  }

  throw lastError || new Error('Retry failed');
}

/**
* Execute a fetch with retry logic
* @param url - URL to fetch
* @param init - Fetch options with optional retry settings
* @returns Response object
*/
export async function fetchWithRetry(
  url: string,
  init: RequestInit & { retry?: RetryOptions } = {}
): Promise<Response> {
  const { retry, ...fetchInit } = init;

  return withRetry(async () => {
  const response = await fetch(url, fetchInit);

  // If response is not ok and status is retryable, throw with status
  if (!response.ok && isRetryableStatus(response.status, retry?.retryableStatuses)) {
    const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
    (error as Error & { status: number; retryAfter?: string }).status = response.status;
    (error as Error & { status: number; retryAfter?: string | undefined }).retryAfter = response.headers.get('retry-after') ?? undefined;
    throw error;
  }

  return response;
  }, retry);
}

/**
* Create a retryable function wrapper
* @param fn - Function to wrap
* @param defaultOptions - Default retry options
* @returns Retryable function
*/
export function createRetryableFunction<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  defaultOptions: RetryOptions = {}
): T {
  return ((...args: unknown[]) => withRetry(() => fn(...args) as Promise<unknown>, defaultOptions)) as T;
}
