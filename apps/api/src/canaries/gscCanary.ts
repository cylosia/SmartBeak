import type { GoogleSearchConsoleAdapter, CanaryResult } from './types';
import { runAdapterCanary } from './AdapterCanaryRunner';

/**
* Google Search Console Canary
*
* Health check for Google Search Console adapter connectivity.
* Attempts to fetch search analytics data.
*
* @module canaries/gscCanary
*/

/**
* Run Google Search Console canary health check
* @param adapter - Google Search Console adapter instance
* @returns Canary check result with health status and latency
*/
export async function gscCanary(adapter: GoogleSearchConsoleAdapter): Promise<CanaryResult> {
  const startTime = Date.now();
  try {
  await runAdapterCanary('gsc', async () => {
    await adapter.healthCheck();
  });
  return {
    name: 'gsc',
    healthy: true,
    latency: Date.now() - startTime,
  };
  } catch (error) {
  return {
    name: 'gsc',
    healthy: false,
    latency: Date.now() - startTime,
    error: error instanceof Error ? error["message"] : 'Unknown error',
  };
  }
}
