import type { VercelAdapter, CanaryResult } from './types';
import { runAdapterCanary } from './AdapterCanaryRunner';

/**
* Vercel Canary
*
* Health check for Vercel adapter connectivity.
* Uses dry-run deploy validation.
*
* @module canaries/vercelCanary
*/

/**
* Run Vercel canary health check
* @param adapter - Vercel adapter instance
* @returns Canary check result with health status and latency
*/
export async function vercelCanary(adapter: VercelAdapter): Promise<CanaryResult> {
  const startTime = Date.now();
  try {
  await runAdapterCanary('vercel', async () => {
    await adapter.healthCheck();
  });
  return {
    name: 'vercel',
    healthy: true,
    latency: Date.now() - startTime,
  };
  } catch (error) {
  return {
    name: 'vercel',
    healthy: false,
    latency: Date.now() - startTime,
    error: error instanceof Error ? error["message"] : 'Unknown error',
  };
  }
}
