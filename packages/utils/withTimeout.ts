/**
* Timeout wrapper utilities for async operations
*/

/**
* Error thrown when an operation times out
*/
export class TimeoutError extends Error {
  constructor(message: string = 'Operation timed out') {
  super(message);
  this.name = 'TimeoutError';
  }
}

/**
* Wrap a promise with a timeout
* @param promise - The promise to wrap
* @param timeoutMs - Timeout in milliseconds
* @param message - Optional custom timeout message
* @returns Promise that rejects if timeout is exceeded
*/
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message?: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new TimeoutError(message || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
* P1-FIX: Bounded timeout constants to prevent excessive resource usage
*/
const MIN_TIMEOUT_MS = 100; // Minimum 100ms timeout
const MAX_TIMEOUT_MS = 300000; // Maximum 5 minutes timeout
const DEFAULT_TIMEOUT_MS = 30000; // Default 30 seconds

/**
* Clamp timeout to safe bounds
* @param timeoutMs - Requested timeout
* @returns Clamped timeout
*/
function clampTimeout(timeoutMs: number): number {
  return Math.min(Math.max(timeoutMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

/**
* Fetch with timeout wrapper
* P1-FIX: Added bounded timeout limits to prevent excessive resource usage
* @param url - URL to fetch
* @param options - Fetch options
* @param timeoutMs - Timeout in milliseconds (default: 30000, min: 100, max: 300000)
* @returns Fetch response
*/
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  // P1-FIX: Clamp timeout to safe bounds
  const safeTimeoutMs = clampTimeout(timeoutMs);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), safeTimeoutMs);

  try {
  const response = await fetch(url, {
    ...options,
    signal: controller.signal,
  });
  return response;
  } catch (error) {
  if (error instanceof Error && error.name === 'AbortError') {
    throw new TimeoutError(`Request to ${url} timed out after ${safeTimeoutMs}ms`);
  }
  throw error;
  } finally {
  clearTimeout(timeoutId);
  }
}
