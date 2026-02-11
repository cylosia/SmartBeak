import type { PinterestAdapter, CanaryResult } from './types';
import { runMediaCanary } from './mediaCanaries';

/**
* Pinterest Canary
*
* Health check for Pinterest adapter connectivity.
* Part of the media canaries group.
*
* @module canaries/pinterestCanary
*/

/**
* Run Pinterest canary health check
* @param adapter - Pinterest adapter instance
* @returns Canary check result with health status and latency
*/
export async function pinterestCanary(adapter: PinterestAdapter): Promise<CanaryResult> {
  const startTime = Date.now();
  try {
  await runMediaCanary('pinterest', async () => {
    await adapter.healthCheck();
  });
  return {
    name: 'pinterest',
    healthy: true,
    latency: Date.now() - startTime,
  };
  } catch (error) {
  return {
    name: 'pinterest',
    healthy: false,
    latency: Date.now() - startTime,
    error: error instanceof Error ? error["message"] : 'Unknown error',
  };
  }
}
