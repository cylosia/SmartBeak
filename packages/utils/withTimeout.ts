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
* P1-8 FIX: Added optional AbortController support for cancellation propagation.
* When the timeout fires, the controller is aborted so the underlying operation can clean up.
*
* @param promise - The promise to wrap
* @param timeoutMs - Timeout in milliseconds
* @param options - Optional configuration object (or deprecated string message)
* @param options.message - Custom timeout error message
* @param options.controller - AbortController to abort when the timeout fires.
*   Pass the AbortController (not controller.signal) so we can call .abort() on it.
* @returns Promise that rejects if timeout is exceeded
*
* @deprecated Passing a plain string as `options` is deprecated.
*   Use `{ message: '...' }` instead.
*/
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  options?: string | { message?: string; controller?: AbortController }
): Promise<T> {
  // Support legacy string message parameter
  const config = typeof options === 'string'
    ? { message: options }
    : (options ?? {});

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      // Abort the controller to propagate cancellation to the underlying operation
      if (config.controller) {
        config.controller.abort();
      }
      reject(new TimeoutError(config.message || `Operation timed out after ${timeoutMs}ms`));
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
* P2-14 FIX: URL no longer leaked in timeout error messages
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

  // P1-2 FIX: Honor the caller's existing AbortSignal rather than silently
  // overwriting it. When the caller aborts, we also abort our timeout controller
  // so the fetch sees the cancellation immediately.
  const callerSignal = options.signal instanceof AbortSignal ? options.signal : undefined;
  let callerAbortListener: (() => void) | undefined;
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timeoutId);
      controller.abort(callerSignal.reason);
    } else {
      callerAbortListener = () => { controller.abort(callerSignal.reason); };
      callerSignal.addEventListener('abort', callerAbortListener, { once: true });
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // P2-14 FIX: Don't leak URL in error message (may contain API keys in query params)
      throw new TimeoutError(`Request timed out after ${safeTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (callerSignal && callerAbortListener) {
      callerSignal.removeEventListener('abort', callerAbortListener);
    }
  }
}
