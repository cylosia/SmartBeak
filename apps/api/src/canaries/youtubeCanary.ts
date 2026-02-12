import type { YouTubeAdapter, CanaryResult } from './types';
import { runMediaCanary } from './mediaCanaries';
import { DEFAULT_TIMEOUTS } from '@config';

/**
* YouTube Canary
*
* Health check for YouTube adapter connectivity.
* Uses metadata-only safe check via media canaries.
*
* Security audit 2 fixes:
* - P2-6: Added outer timeout to prevent indefinite hang if metric emission blocks
*
* Security audit 3 fixes:
* - P2-2: Timer cleared after Promise.race resolves to prevent timer leak
* - P2-3: (documented) CanaryAdapter interface lacks AbortSignal support;
*          if the timeout fires, the underlying HTTP request continues until
*          healthCheck's own AbortController fires. Interface change needed
*          to propagate cancellation (future follow-up).
*
* @module canaries/youtubeCanary
*/

/** P2-6 FIX (audit 2): Outer timeout prevents unbounded Promise accumulation
 * if runMediaCanary or metric emission infrastructure hangs. */
const CANARY_TIMEOUT_MS = DEFAULT_TIMEOUTS.medium;

/**
* Run YouTube canary health check
* @param adapter - YouTube adapter instance
* @returns Canary check result with health status and latency
*/
export async function youtubeCanary(adapter: YouTubeAdapter): Promise<CanaryResult> {
  const startTime = Date.now();
  // P2-2 FIX (audit 3): Capture timer ID so it can be cleared after the race,
  // preventing 15-second lingering timers under high-frequency canary checks.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      runMediaCanary('youtube', async () => {
        const result = await adapter.healthCheck();
        if (!result.healthy) {
          throw new Error(result.error ?? 'YouTube health check returned unhealthy');
        }
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('YouTube canary timed out')), CANARY_TIMEOUT_MS);
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
