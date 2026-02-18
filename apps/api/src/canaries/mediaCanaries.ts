import { getLogger } from '@kernel/logger';
import { emitMetric } from '../ops/metrics';


/**
* Media Canary Runner
*
* Executes health checks for media-related adapters (YouTube, Instagram, Pinterest)
* with proper error handling and metrics emission.
*
* @module canaries/mediaCanaries
*/

/** Logger for media canary operations */
const logger = getLogger('media-canary');

/** P2-18 FIX: Default timeout for canary checks (30 seconds) */
const CANARY_TIMEOUT_MS = 30000;

/**
* Run a media adapter canary health check
*
* @param name - Name of the media adapter being checked
* @param fn - Health check function to execute
* @param timeoutMs - Timeout in milliseconds (default: 30000)
* @throws Error if the health check fails or times out
*/
export async function runMediaCanary(name: string, fn: () => Promise<void>, timeoutMs: number = CANARY_TIMEOUT_MS): Promise<void> {
  // FIX(P1): Capture the timer handle so it can be cleared once fn() resolves.
  // Without clearTimeout the timer holds the Node.js event loop open for
  // `timeoutMs` (30 s) after every successful run, blocking clean process
  // shutdown in tests and Lambda-style short-lived invocations.
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    // P2-18 FIX: Add timeout to prevent canary checks from hanging indefinitely
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Canary check '${name}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    await Promise.race([fn(), timeoutPromise]);
    emitMetric({ name: 'media_canary_success', labels: { name } });
  } catch (error) {
    // P1-9 FIX: Safe error handling for unknown error type instead of unsafe cast
    const safeError = error instanceof Error ? error : new Error(String(error));
    // P3-4 FIX: Use error level, not warn — canary failures indicate service degradation
    logger.error(`[MediaCanary] ${name} failed:`, safeError);
    emitMetric({ name: 'media_canary_failure', labels: { name } });
    throw safeError;
  } finally {
    // FIX(P1): Always clear the timeout — prevents event-loop retention on success
    clearTimeout(timeoutHandle);
  }
}
