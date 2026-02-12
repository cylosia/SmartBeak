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
  try {
    await Promise.race([
      runMediaCanary('youtube', async () => {
        const result = await adapter.healthCheck();
        if (!result.healthy) {
          throw new Error(result.error ?? 'YouTube health check returned unhealthy');
        }
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('YouTube canary timed out')), CANARY_TIMEOUT_MS)
      ),
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
  }
}
