import type { YouTubeAdapter, CanaryResult } from './types';
import { runMediaCanary } from './mediaCanaries';

/**
* YouTube Canary
*
* Health check for YouTube adapter connectivity.
* Uses metadata-only safe check via media canaries.
*
* @module canaries/youtubeCanary
*/

/**
* Run YouTube canary health check
* @param adapter - YouTube adapter instance
* @returns Canary check result with health status and latency
*/
export async function youtubeCanary(adapter: YouTubeAdapter): Promise<CanaryResult> {
  const startTime = Date.now();
  try {
  await runMediaCanary('youtube', async () => {
    await adapter.healthCheck();
  });
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
    error: error instanceof Error ? error["message"] : 'Unknown error',
  };
  }
}
