// ============================================================================
// Type Definitions
// ============================================================================

// P2-FIX: Use @kernel alias instead of fragile relative path crossing package boundaries
import { getLogger } from '@kernel/logger';

const logger = getLogger('BatchService');

// P2-FIX: Enforce maximum concurrency ceiling to prevent unbounded parallel operations
const MAX_BATCH_CONCURRENCY = 100;

/**
* Result of batch processing
*/
export interface BatchResult {
  /** Number of successful operations */
  successCount: number;
  /** Number of failed operations */
  failureCount: number;
  /** Array of errors */
  errors: Error[];
}

// ============================================================================
// Batch Processing Functions
// ============================================================================

/**
* Processes items in batches with error handling.
*
* @param items - Array of items to process
* @param batchSize - Number of items to process concurrently in each batch
* @param fn - Async function to process each item
* @returns Result with success/failure counts and errors
* @throws Error if validation fails
*/
export async function processInBatches<T>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<void>
): Promise<BatchResult> {
  // Input validation
  if (!Array.isArray(items)) {
  throw new Error('items must be an array');
  }
  if (typeof batchSize !== 'number' || !Number.isInteger(batchSize) || batchSize < 1) {
  throw new Error('batchSize must be a positive integer');
  }
  // P2-FIX: Enforce concurrency ceiling to prevent unbounded parallel operations
  if (batchSize > MAX_BATCH_CONCURRENCY) {
  throw new Error(`batchSize must not exceed ${MAX_BATCH_CONCURRENCY}`);
  }
  if (typeof fn !== 'function') {
  throw new Error('fn must be a function');
  }

  const result: BatchResult = {
  successCount: 0,
  failureCount: 0,
  errors: []
  };

  for (let i = 0; i < items.length; i += batchSize) {
  const batch = items.slice(i, i + batchSize);
  const batchNumber = Math.floor(i / batchSize) + 1;
  const totalBatches = Math.ceil(items.length / batchSize);

  logger.info(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} items)`);

  const batchResults = await Promise.allSettled(batch.map(fn));

  for (const [index, batchResult] of batchResults.entries()) {
    if (batchResult.status === 'fulfilled') {
    result.successCount++;
    } else {
    result.failureCount++;
    const error = batchResult.reason instanceof Error
    ? batchResult.reason
    : new Error(String(batchResult.reason));
    result.errors.push(error);

    logger.error(`Error processing item at index ${i + index}`, error);
    }
  }
  }

  logger.info(`Completed: ${result.successCount} succeeded, ${result.failureCount} failed`);

  return result;
}

/**
* Processes items in batches with abort on first error.
*
* @param items - Array of items to process
* @param batchSize - Number of items to process concurrently in each batch
* @param fn - Async function to process each item
* @returns Number of processed items
* @throws Error if any item fails processing
*/
export async function processInBatchesStrict<T>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<void>
): Promise<number> {
  // Input validation
  if (!Array.isArray(items)) {
  throw new Error('items must be an array');
  }
  if (typeof batchSize !== 'number' || !Number.isInteger(batchSize) || batchSize < 1) {
  throw new Error('batchSize must be a positive integer');
  }
  if (batchSize > MAX_BATCH_CONCURRENCY) {
  throw new Error(`batchSize must not exceed ${MAX_BATCH_CONCURRENCY}`);
  }
  if (typeof fn !== 'function') {
  throw new Error('fn must be a function');
  }

  let processedCount = 0;

  for (let i = 0; i < items.length; i += batchSize) {
  const batch = items.slice(i, i + batchSize);
  const batchNumber = Math.floor(i / batchSize) + 1;
  const totalBatches = Math.ceil(items.length / batchSize);

  logger.info(`[batch-strict] Processing batch ${batchNumber}/${totalBatches} (${batch.length} items)`);

  // P1-FIX: Use Promise.allSettled instead of Promise.all for error isolation
  const batchResults = await Promise.allSettled(batch.map(fn));

  // P1-FIX: Collect all errors, not just the first one
  const batchErrors: Array<{ index: number; error: Error }> = [];
  for (const [index, result] of batchResults.entries()) {
    if (result.status === 'rejected') {
    const error = result['reason'] instanceof Error
    ? result['reason']
    : new Error(String(result['reason']));
    batchErrors.push({ index: i + index, error });
    }
  }

  // P1-FIX: If any errors occurred, throw aggregated error
  if (batchErrors.length > 0) {
    const aggregatedError = new Error(
    `Batch processing failed for ${batchErrors.length} items: ` +
    batchErrors.map(e => `index ${e['index']}: ${e['error']['message']}`).join(', ')
    );
    (aggregatedError as Error & { errors: typeof batchErrors }).errors = batchErrors;
    throw aggregatedError;
  }

  processedCount += batch.length;
  }

  logger.info(`[batch-strict] Completed: ${processedCount} items processed`);

  return processedCount;
}

/**
* Maps items in batches with error handling.
*
* @param items - Array of items to map
* @param batchSize - Number of items to process concurrently in each batch
* @param fn - Async function to map each item
* @returns Object with successful results and errors
* @throws Error if validation fails
*/
export async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>
): Promise<{ results: R[]; errors: Array<{ item: T; error: Error }> }> {
  // Input validation
  if (!Array.isArray(items)) {
  throw new Error('items must be an array');
  }
  if (typeof batchSize !== 'number' || !Number.isInteger(batchSize) || batchSize < 1) {
  throw new Error('batchSize must be a positive integer');
  }
  if (batchSize > MAX_BATCH_CONCURRENCY) {
  throw new Error(`batchSize must not exceed ${MAX_BATCH_CONCURRENCY}`);
  }
  if (typeof fn !== 'function') {
  throw new Error('fn must be a function');
  }

  const results: R[] = [];
  const errors: Array<{ item: T; error: Error }> = [];

  for (let i = 0; i < items.length; i += batchSize) {
  const batch = items.slice(i, i + batchSize);
  const batchNumber = Math.floor(i / batchSize) + 1;
  const totalBatches = Math.ceil(items.length / batchSize);

  logger.info(`[map-batch] Processing batch ${batchNumber}/${totalBatches} (${batch.length} items)`);

  const batchResults = await Promise.allSettled(batch.map(fn));

  for (const [index, batchResult] of batchResults.entries()) {
    if (batchResult.status === 'fulfilled') {
    results.push(batchResult.value as unknown as R);
    } else {
    const error = batchResult.reason instanceof Error
    ? batchResult.reason
    : new Error(String(batchResult.reason));
    errors.push({ item: batch[index] as T, error });

    logger.error(`[map-batch] Error mapping item at index ${i + index}`, error);
    }
  }
  }

  logger.info(`[map-batch] Completed: ${results.length} succeeded, ${errors.length} failed`);

  return { results, errors };
}
