import type { GoogleAnalyticsAdapter, CanaryResult } from './types';
import { runAdapterCanary } from './AdapterCanaryRunner';

/**
* Google Analytics Canary
*
* Health check for Google Analytics adapter connectivity.
* Attempts to fetch metrics from a canary property.
*
* @module canaries/gaCanary
*/

/**
* Run Google Analytics canary health check
* @param adapter - Google Analytics adapter instance
* @returns Canary check result with health status and latency
*/
export async function gaCanary(adapter: GoogleAnalyticsAdapter): Promise<CanaryResult> {
  const startTime = Date.now();
  try {
  await runAdapterCanary('ga', async () => {
    await adapter.healthCheck();
  });
  return {
    name: 'ga',
    healthy: true,
    latency: Date.now() - startTime,
  };
  } catch (error) {
  return {
    name: 'ga',
    healthy: false,
    latency: Date.now() - startTime,
    error: error instanceof Error ? error["message"] : 'Unknown error',
  };
  }
}
