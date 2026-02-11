import type { InstagramAdapter, CanaryResult } from './types';
import { runMediaCanary } from './mediaCanaries';

/**
* Instagram Canary
*
* Health check for Instagram adapter connectivity.
* Part of the media canaries group.
*
* @module canaries/instagramCanary
*/

/**
* Run Instagram canary health check
* @param adapter - Instagram adapter instance
* @returns Canary check result with health status and latency
*/
export async function instagramCanary(adapter: InstagramAdapter): Promise<CanaryResult> {
  const startTime = Date.now();
  try {
  await runMediaCanary('instagram', async () => {
    await adapter.healthCheck();
  });
  return {
    name: 'instagram',
    healthy: true,
    latency: Date.now() - startTime,
  };
  } catch (error) {
  return {
    name: 'instagram',
    healthy: false,
    latency: Date.now() - startTime,
    error: error instanceof Error ? error["message"] : 'Unknown error',
  };
  }
}
