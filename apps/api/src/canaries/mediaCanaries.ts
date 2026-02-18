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
  // Audit fix: Capture timeoutId so we can clear it after Promise.race resolves.
  // Without this, every fast-completing canary leaves a dangling timer that
  // fires reject() on an already-settled promise 30 s later. Under production
  // polling (e.g. every 5 s) this accumulates hundreds of orphaned timers.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    // P2-18 FIX: Add timeout to prevent canary checks from hanging indefinitely
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Canary check '${name}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    await Promise.race([fn(), timeoutPromise]);
    // Audit fix: Wrap emitMetric in try-catch on the success path. If metric
    // emission throws (e.g. buffer full, rate limited), the error must not
    // surface to the caller as a canary failure — it would cause healthy
    // services to be reported as degraded.
    try {
      emitMetric({ name: 'media_canary_success', labels: { name } });
    } catch (metricErr) {
      logger.error('[MediaCanary] Failed to emit success metric', metricErr instanceof Error ? metricErr : new Error(String(metricErr)));
    }
  } catch (error) {
    // P1-9 FIX: Safe error handling for unknown error type instead of unsafe cast
    const safeError = error instanceof Error ? error : new Error(String(error));
    // P3-4 FIX: Use error level, not warn — canary failures indicate service degradation
    logger.error(`[MediaCanary] ${name} failed:`, safeError);
    // Audit fix: Wrap emitMetric in try-catch on the failure path. If metric
    // emission throws, the metric error must not replace the original canary
    // error — callers depend on the original error for diagnostics.
    try {
      emitMetric({ name: 'media_canary_failure', labels: { name } });
    } catch (metricErr) {
      logger.error('[MediaCanary] Failed to emit failure metric', metricErr instanceof Error ? metricErr : new Error(String(metricErr)));
    }
    throw safeError;
  } finally {
    // Always clear the timer regardless of outcome so it does not fire against
    // an already-settled promise.
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
