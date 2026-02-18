import { DEFAULT_TIMEOUTS } from '@config';

import { runMediaCanary } from './mediaCanaries';
import type { YouTubeAdapter, CanaryResult } from './types';

/**
* YouTube Canary
*
* Health check for YouTube adapter connectivity.
* Uses metadata-only safe check via media canaries.
*
* Audit fixes (all cycles):
* - P2-6: Added outer timeout to prevent indefinite hang if metric emission blocks
* - P2-2: Timer cleared after Promise.race resolves to prevent timer leak
* - P2-7: AbortController created and passed to adapter.healthCheck() so that
*          when the outer timeout fires the underlying HTTP request is cancelled
*          immediately rather than continuing for up to DEFAULT_TIMEOUTS.short
*          more seconds. This eliminates orphaned connections under high-frequency
*          canary polling.
*
* @module canaries/youtubeCanary
*/

/** Outer timeout prevents unbounded Promise accumulation if runMediaCanary hangs */
const CANARY_TIMEOUT_MS = DEFAULT_TIMEOUTS.medium;

/**
* Run YouTube canary health check
* @param adapter - YouTube adapter instance
* @returns Canary check result with health status and latency
*/
export async function youtubeCanary(adapter: YouTubeAdapter): Promise<CanaryResult> {
  const startTime = Date.now();

  // P2-7 FIX: AbortController lets us cancel the in-progress healthCheck when
  // the outer timeout fires, instead of leaving an orphaned HTTP request running
  // for up to DEFAULT_TIMEOUTS.short (5 s) after the canary has already reported
  // unhealthy.
  const outerController = new AbortController();

  // Capture timer ID so it can be cleared after the race resolves,
  // preventing lingering timers under high-frequency canary checks.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      runMediaCanary('youtube', async () => {
        // Pass outerController.signal so the adapter's internal fetch respects
        // the canary-level timeout, not just its own shorter internal timeout.
        const result = await adapter.healthCheck(outerController.signal);
        if (!result.healthy) {
          throw new Error(result.error ?? 'YouTube health check returned unhealthy');
        }
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          // P2-7 FIX: Abort the in-progress healthCheck before rejecting the
          // race so the underlying HTTP fetch is cancelled immediately.
          outerController.abort();
          reject(new Error('YouTube canary timed out'));
        }, CANARY_TIMEOUT_MS);
      }),
    ]);
    return {
      name: 'youtube',
      healthy: true,
      latency: Date.now() - startTime,
    };
  } catch (error) {
    return {
      name: 'youtube',
      healthy: false,
      latency: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
