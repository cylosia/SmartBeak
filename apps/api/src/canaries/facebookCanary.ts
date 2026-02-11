import type { FacebookAdapter, CanaryResult } from './types';
import { runAdapterCanary } from './AdapterCanaryRunner';

/**
* Facebook Canary
*
* Health check for Facebook adapter connectivity and basic functionality.
* Uses dry-run validation to verify adapter configuration.
*
* @module canaries/facebookCanary
*/

/**
* Run Facebook canary health check
* @param adapter - Facebook adapter instance
* @returns Canary check result with health status and latency
*/
export async function facebookCanary(adapter: FacebookAdapter): Promise<CanaryResult> {
  const startTime = Date.now();
  try {
  await runAdapterCanary('facebook', async () => {
    await adapter.healthCheck();
  });
  return {
    name: 'facebook',
    healthy: true,
    latency: Date.now() - startTime,
  };
  } catch (error) {
  return {
    name: 'facebook',
    healthy: false,
    latency: Date.now() - startTime,
    error: error instanceof Error ? error["message"] : 'Unknown error',
  };
  }
}
