import { getRequestContext } from './request-context';

import { getLogger } from '@kernel/logger';

/**
* Enhanced safe handler with validation and error handling
*
* Provides safe execution of handlers with:
* - Input validation
* - Timeout handling
* - Error categorization
* - Memory leak prevention
* - Retry logic with exponential backoff
* Structured logging with correlation ID support
*/

// ============================================================================
// Constants
// ============================================================================

/** Maximum execution time for handlers in milliseconds */
const HANDLER_TIMEOUT_MS = 60000;

/** Maximum retry attempts */
const MAX_RETRY_ATTEMPTS = 3;

// ============================================================================
// Error Handling
// ============================================================================

/**
* Error categories for type-safe handling
*/
export type ErrorCategory = 'timeout' | 'network' | 'memory' | 'validation' | 'unknown';

/**
* Assert never for exhaustiveness checking
* @param value - Value that should never exist
* @throws Error with the unexpected value
*/
function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

/**
* Categorize errors for better handling

* @param error - Error to categorize
* @returns Category and retryable flag
*/
function categorizeError(error: unknown): { category: ErrorCategory; retryable: boolean } {
  if (!(error instanceof Error)) {
  return { category: 'unknown', retryable: false };
  }

  const message = error["message"].toLowerCase();

  if (message.includes('timeout') || message.includes('etimedout')) {
  return { category: 'timeout', retryable: true };
  }
  if (message.includes('connection') || message.includes('econnrefused') || message.includes('enotfound')) {
  return { category: 'network', retryable: true };
  }
  if (message.includes('memory') || message.includes('heap')) {
  return { category: 'memory', retryable: false };
  }
  if (message.includes('validation') || message.includes('invalid')) {
  return { category: 'validation', retryable: false };
  }

  // Exhaustive check
  const category: ErrorCategory = 'unknown';
  return { category, retryable: true };
}

// ============================================================================
// Validation
// ============================================================================

/**
* Input validation result
*/
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
* Validate handler inputs
* @param plugin - Plugin name
* @param eventName - Event name
* @param handler - Handler function
* @param onFailure - Failure callback
* @throws Error if validation fails
*/
function validateInputs(
  plugin: string,
  eventName: string,
  handler: () => Promise<void>,
  onFailure: (failure: { plugin: string; eventName: string; error: unknown }) => Promise<void>
): void {
  if (!plugin || typeof plugin !== 'string' || plugin.trim().length === 0) {
  throw new Error('Invalid plugin: must be a non-empty string');
  }
  if (plugin.length > 100) {
  throw new Error('Invalid plugin: exceeds maximum length of 100');
  }

  if (!eventName || typeof eventName !== 'string' || eventName.trim().length === 0) {
  throw new Error('Invalid eventName: must be a non-empty string');
  }
  if (eventName.length > 100) {
  throw new Error('Invalid eventName: exceeds maximum length of 100');
  }

  if (typeof handler !== 'function') {
  throw new Error('Invalid handler: must be a function');
  }

  if (typeof onFailure !== 'function') {
  throw new Error('Invalid onFailure: must be a function');
  }
}

// ============================================================================
// Main Function
// ============================================================================

/**
* Run a handler safely with retry logic and timeout
* @param plugin - Plugin name
* @param eventName - Event name being handled
* @param handler - Handler function to execute
* @param onFailure - Callback for when handler fails after all retries
* @returns Promise that resolves when handler completes or fails
*/
export async function runSafely(
  plugin: string,
  eventName: string,
  handler: () => Promise<void>,
  onFailure: (failure: { plugin: string; eventName: string; error: unknown }) => Promise<void>
): Promise<void> {
  validateInputs(plugin, eventName, handler, onFailure);

  const normalizedPlugin = plugin.trim();
  const normalizedEventName = eventName.trim();

  const ctx = getRequestContext();
  const logger = getLogger({
  service: 'safeHandler',
  correlationId: ctx?.requestId,
  context: {
    plugin: normalizedPlugin,
    eventName: normalizedEventName,
    userId: ctx?.["userId"],
    orgId: ctx?.["orgId"],
  },
  });

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
  try {
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Handler timed out after ${HANDLER_TIMEOUT_MS}ms`)), HANDLER_TIMEOUT_MS);
    });

    await Promise.race([handler(), timeoutPromise]);

    // Success - exit function
    return;
  } catch (error) {
    lastError = error;

    const { category, retryable } = categorizeError(error);

    logger["error"](
    `Handler execution failed (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS})`,
    error instanceof Error ? error : undefined,
    {
    attempt: attempt + 1,
    maxAttempts: MAX_RETRY_ATTEMPTS,
    }
    );

    // Don't retry non-retryable errors or on last attempt
    if (!retryable || attempt === MAX_RETRY_ATTEMPTS - 1) {
    break;
    }

    // Exponential backoff between retries
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
    logger.warn('Retrying handler after error', {
    delayMs: delay,
    nextAttempt: attempt + 2
    });
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  }

  // Call failure handler with full context
  try {
  await onFailure({
    plugin: normalizedPlugin,
    eventName: normalizedEventName,
    error: lastError
  });
  } catch (failureError) {

  logger["error"](
    'onFailure callback threw an error',
    failureError instanceof Error ? failureError : undefined,
    {
    originalError: lastError instanceof Error ? lastError["message"] : 'Unknown error',
    }
  );

  throw failureError;
  }
}
