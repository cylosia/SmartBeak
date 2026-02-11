import { getLogger } from '@kernel/logger';
import { emitMetric } from '../ops/metrics';


/**
* Adapter Canary Runner
*
* Executes health checks for adapter connections with proper error handling,
* timeout management, and metrics emission.
*
* MEDIUM FIX M1, M3, M4: Enhanced error handling and validation
* - Input validation for canary name
* - Error logging with context
* - Timeout handling
* - Result tracking
*
* @module canaries/AdapterCanaryRunner
*/

/** Logger for adapter canary operations */
const logger = getLogger('adapter-canary');

const CANARY_TIMEOUT_MS = 30000;

/**
* MEDIUM FIX M3: Validate canary name
*/
function validateCanaryName(name: string): void {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
  throw new Error('Invalid canary name: must be a non-empty string');
  }
  if (name.length > 100) {
  throw new Error('Invalid canary name: exceeds maximum length of 100');
  }
}

export async function runAdapterCanary(name: string, fn: () => Promise<void>): Promise<{ success: boolean; duration: number; error?: string }> {
  validateCanaryName(name);

  if (typeof fn !== 'function') {
  throw new Error('Invalid canary function: must be a function');
  }

  const startTime = Date.now();

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Canary timed out after ${CANARY_TIMEOUT_MS}ms`)), CANARY_TIMEOUT_MS);
  });

  await Promise.race([fn(), timeoutPromise]);

  const duration = Date.now() - startTime;

  emitMetric({ name: 'canary_success', labels: { name }, value: duration });
  logger.info(`[AdapterCanary] Success: ${name} completed in ${duration}ms`);

  return { success: true, duration };
  } catch (error) {
  const duration = Date.now() - startTime;

    const errorMessage = error instanceof Error ? error["message"] : 'Unknown error';
  logger.error(`[AdapterCanary] Failure: ${name} failed after ${duration}ms:`, error as Error);

    emitMetric({
    name: 'canary_failure',
    labels: {
    error_type: error instanceof Error ? error.constructor.name : 'unknown'
    },
    value: duration,
  });

  return { success: false, duration, error: errorMessage };
  }
}
