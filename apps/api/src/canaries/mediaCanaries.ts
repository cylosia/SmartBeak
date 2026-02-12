import { getLogger } from '@kernel/logger';
import { emitMetric } from '../ops/metrics';


/**
* Media Canary Runner
*
* Executes health checks for media-related adapters (YouTube, Instagram, Pinterest)
* with proper error handling and metrics emission.
*
* @module canaries/mediaCanaries
*/

/** Logger for media canary operations */
const logger = getLogger('media-canary');

/**
* Run a media adapter canary health check
*
* @param name - Name of the media adapter being checked
* @param fn - Health check function to execute
* @throws Error if the health check fails
*/
export async function runMediaCanary(name: string, fn: () => Promise<void>): Promise<void> {
  // P3-4 FIX: Corrected indentation to match project conventions
  try {
    await fn();
    emitMetric({ name: 'media_canary_success', labels: { name } });
  } catch (error) {
    logger.error(`[MediaCanary] ${name} failed:`, error as Error);
    emitMetric({ name: 'media_canary_failure', labels: { name } });
    throw error;
  }
}
