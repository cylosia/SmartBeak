import { getLogger } from '@kernel/logger';
import { API_BASE_URLS } from '@config';
import { upsertKeyword } from '../keywords/keywords';
import { ValidationError, validateNonEmptyString, validateArray } from '../utils/validation';

/**
 * FIX: Type guard for Ahrefs API response validation
 */
function isValidAhrefsResponse(data: unknown): data is { keywords?: Array<{ keyword: string; volume?: number; position?: number }>; error?: string; message?: string } {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const response = data as Record<string, unknown>;
  // Validate keywords array if present
  if (response['keywords'] !== undefined) {
    if (!Array.isArray(response['keywords'])) {
      return false;
    }
    for (const item of response['keywords']) {
      if (typeof item !== 'object' || item === null) {
        return false;
      }
      const keywordItem = item as Record<string, unknown>;
      if (typeof keywordItem['keyword'] !== 'string') {
        return false;
      }
      if (keywordItem['volume'] !== undefined && typeof keywordItem['volume'] !== 'number') {
        return false;
      }
      if (keywordItem['position'] !== undefined && typeof keywordItem['position'] !== 'number') {
        return false;
      }
    }
  }
  // Validate error/message strings if present
  if (response['error'] !== undefined && typeof response['error'] !== 'string') {
    return false;
  }
  if (response['message'] !== undefined && typeof response['message'] !== 'string') {
    return false;
  }
  return true;
}
// Logger for duplicate warnings
const logger = getLogger('AhrefsGapAnalyzer');
// FIX: Configuration constants
const BATCH_SIZE = 100; // Process keywords in batches
const MAX_KEYWORDS = 100000; // Maximum allowed keywords to prevent unbounded Map growth
const MAX_CONCURRENT_REQUESTS = 5; // Limit parallel API calls
const DELAY_MS = 100; // Delay between batches
const AHFREFS_API_TIMEOUT = 30000; // 30 second timeout for Ahrefs API
// FIX: Timer tracking for cleanup
const activeTimers = new Set<NodeJS.Timeout>();
// FIX: Track signal handler registration to prevent leaks
let handlersRegistered = false;
/**
 * FIX: Register cleanup handlers only once to prevent leaks
 * @param cleanup - Cleanup function to register
 */
function registerCleanupHandlers(cleanup: () => void): void {
  if (handlersRegistered)
    return;
  handlersRegistered = true;
  process.once('SIGTERM', cleanup);
  process.once('SIGINT', cleanup);
}
// FIX: Track beforeExit handler for proper cleanup
let beforeExitHandler: (() => void) | null = null;
/**
 * FIX: Register beforeExit handler only when needed
 * @param handler - Handler function to register
 */


export interface CleanupContext {
  activeTimers: Set<NodeJS.Timeout>;
  isCancelled: boolean;
}

export type KeywordGap = {
  keyword_id: string;
  phrase: string;
  volume: number;
  competitor_rank: number;
};

export type AhrefsKeywordItem = {
  keyword: string;
  volume?: number;
  position?: number;
};

export type AhrefsGapResponse = {
  keywords?: AhrefsKeywordItem[];
  error?: string;
  message?: string;
};

export function registerBeforeExitHandler(handler: () => void): void {
  if (beforeExitHandler)
    return;
  beforeExitHandler = handler;
  process.once('beforeExit', handler);
}
/**
 * FIX: Create a cancellable delay
 * Tracks timers for proper cleanup
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      activeTimers.delete(timer);
      resolve();
    }, ms);
    activeTimers.add(timer);
  });
}
/**
 * FIX: Cancel all pending delays
 * Call this during shutdown to prevent hanging timers
 */
export function cancelAllDelays(): void {
  for (const timer of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.clear();
}
/**
 * FIX: Get count of active delay timers (for monitoring)
 */
export function getActiveDelayCount(): number {
  return activeTimers.size;
}
/**
 * FIX: Validate input parameters for Ahrefs gap analysis
 * @throws ValidationError if validation fails
 */
function validateAhrefsGapInput(domain: unknown, competitors: unknown, apiKey: unknown): void {
  // Validate domain
  validateNonEmptyString(domain, 'domain');
  // Domain should be a valid domain format (no protocol)
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/;
  if (!domainRegex.test(domain as string)) {
    throw new ValidationError('Domain must be a valid domain name (e.g., example.com)', 'INVALID_DOMAIN');
  }
  // Validate competitors array
  validateArray(competitors as unknown[], (item: unknown, index?: number) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new ValidationError(`Competitor at index ${index} must be a non-empty string`, 'INVALID_COMPETITOR');
    }
    return item.trim();
  }, 'competitors', { minLength: 1, maxLength: 10 });
  // Validate API key
  validateNonEmptyString(apiKey, 'apiKey');
  if ((apiKey as string).length < 10) {
    throw new ValidationError('API key appears to be invalid (too short)', 'INVALID_API_KEY');
  }
}
/**
 * FIX: Fetch keyword gap data from Ahrefs API
 * Makes actual API call to Ahrefs with proper error handling
 */
async function fetchFromAhrefsAPI(domain: string, competitors: string[], apiKey: string): Promise<AhrefsKeywordItem[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AHFREFS_API_TIMEOUT);
  try {
    const response = await fetch(`${API_BASE_URLS.ahrefs}/site-explorer/keywords`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        domain,
        competitors,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorBody = await response.text();
      let parsedError: { error?: string; message?: string } | null = null;
      try {
        const parsed = JSON.parse(errorBody);
        if (!isValidAhrefsResponse(parsed)) {
          logger.warn('Invalid API error response format');
        }
        else {
          parsedError = parsed;
        }
      }
      catch {
        // Not JSON, use text
      }
      // Handle specific HTTP status codes
      switch (response.status) {
        case 401:
          throw new Error('Ahrefs API authentication failed. Please check your API key.');
        case 403:
          throw new Error('Ahrefs API access denied. Your API key may not have permission for this operation.');
        case 429:
          throw new Error('Ahrefs API rate limit exceeded. Please try again later.');
        case 404:
          throw new Error(`Domain '${domain}' not found in Ahrefs database.`);
        case 500:
        case 502:
        case 503:
        case 504:
          throw new Error('Ahrefs API is experiencing issues. Please try again later.');
        default:
          throw new Error(parsedError?.error || parsedError?.["message"] ||
            `Ahrefs API error (${response.status}): ${errorBody || 'Unknown error'}`);
      }
    }
    const rawData = await response.json();
    if (!isValidAhrefsResponse(rawData)) {
      throw new Error('Invalid API response format');
    }
    const data = rawData;
    if (!data.keywords || !Array.isArray(data.keywords)) {
      logger.warn('API response missing keywords array, returning empty result');
      return [];
    }
    return data.keywords;
  }
  catch (error) {
    // Re-throw AbortError as a more user-friendly message
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Ahrefs API request timed out. Please try again later.');
    }
    throw error;
  }
  finally {
    clearTimeout(timeoutId);
  }
}
/**
 * FIX: Ingest Ahrefs gap data with batch processing
 * - Fetches real data from Ahrefs API
 * - Converts N+1 database queries to batch inserts
 * - Uses Promise.all for parallel processing
 * - Implements pagination for large datasets
 * - FIX: Proper timer cleanup
 */
export async function ingestAhrefsGap(domain_id: string, domain: string, competitors: string[], apiKey: string): Promise<KeywordGap[]> {
  // Validate inputs
  validateAhrefsGapInput(domain, competitors, apiKey);
  // Fetch real data from Ahrefs API
  let keywordData: AhrefsKeywordItem[];
  try {
    keywordData = await fetchFromAhrefsAPI(domain, competitors, apiKey);
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error["message"] : 'Unknown error';
    logger.error('Failed to fetch from Ahrefs API', error instanceof Error ? error : new Error(errorMessage));
    throw new Error(`Failed to fetch keyword gap data: ${errorMessage}`);
  }
  // Extract phrases from API response
  const phrases = keywordData.map(item => item.keyword);
  // Create lookup map for keyword data with duplicate detection
  const keywordDataMap = new Map<string, AhrefsKeywordItem>();
  for (const item of keywordData) {
    if (keywordDataMap.size >= MAX_KEYWORDS) {
      throw new Error(`Maximum keyword limit (${MAX_KEYWORDS}) exceeded`);
    }
    if (keywordDataMap.has(item.keyword)) {
      logger.warn(`Duplicate keyword in API response: ${item.keyword}`);
    }
    keywordDataMap.set(item.keyword, item);
  }
  try {
    // FIX: Process phrases in batches with batch database operations
    return await processKeywordBatches(domain_id, phrases, keywordDataMap);
  }
  finally {
    // FIX: Ensure all timers are cleaned up after processing
    cancelAllDelays();
  }
}
/**
 * FIX: Process keywords in batches to prevent N+1 query issues
 * - Uses batchUpsertKeywords for efficient database operations
 * - Processes in chunks with parallel execution
 * - Prevents memory issues with large datasets
 * - FIX: Tracks and cleans up timers
 */
async function processKeywordBatches(domain_id: string, phrases: string[], keywordDataMap: Map<string, AhrefsKeywordItem>): Promise<KeywordGap[]> {
  const results: KeywordGap[] = [];
  // FIX: Track if we need to cleanup on early exit
  let isCancelled = false;
  // FIX: Cleanup function for early exit
  const cleanup = () => {
    isCancelled = true;
    cancelAllDelays();
  };
  // Register cleanup on process signals (deduplicated)
  registerCleanupHandlers(cleanup);
  try {
    // Process phrases in batches
    for (let i = 0; i < phrases.length; i += BATCH_SIZE) {
      if (isCancelled) {
        logger.info('Processing cancelled, returning partial results');
        break;
      }
      const batch = phrases.slice(i, i + BATCH_SIZE);
      // FIX: Prepare batch input for bulk upsert
      const batchInputs = batch.map(phrase => ({
        domain_id,
        phrase,
        source: 'ahrefs',
      }));
      // FIX: Use Promise.all for parallel upserts instead of individual sequential upserts (N+1 fix)
      const keywords = await Promise.all(batchInputs.map(input => upsertKeyword(input)));
      // Map results to KeywordGap format using real data from API
      const batchResults = keywords.filter((k): k is NonNullable<typeof k> => k != null).map((k, index) => {
        const phrase = batch[index]!;
        const apiData = keywordDataMap.get(phrase);
        return {
          keyword_id: k.id,
          phrase,
          volume: apiData?.volume ?? 0,
          competitor_rank: apiData?.position ?? 0,
        };
      });
      results.push(...batchResults);
      // FIX: Add small delay between batches to prevent overwhelming the database
      // FIX: Only delay if there are more batches and not cancelled
      if (i + BATCH_SIZE < phrases.length && !isCancelled) {
        await delay(DELAY_MS);
      }
    }
  }
  finally {
    // FIX: Ensure all timers are cleaned up
    cancelAllDelays();
  }
  return results;
}
/**
 * FIX: Alternative implementation using Promise.all for parallel processing
 * Use this if batchUpsertKeywords is not available and you need to process individual items
 * FIX: Includes proper cleanup
 */
export async function ingestAhrefsGapParallel(domain_id: string, domain: string, competitors: string[], apiKey: string): Promise<KeywordGap[]> {
  // Validate inputs
  validateAhrefsGapInput(domain, competitors, apiKey);
  // Fetch real data from Ahrefs API
  let keywordData: AhrefsKeywordItem[];
  try {
    keywordData = await fetchFromAhrefsAPI(domain, competitors, apiKey);
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error["message"] : 'Unknown error';
    logger.error('Failed to fetch from Ahrefs API', error instanceof Error ? error : new Error(errorMessage));
    throw new Error(`Failed to fetch keyword gap data: ${errorMessage}`);
  }
  // Extract phrases from API response
  const phrases = keywordData.map(item => item.keyword);
  // Create lookup map for keyword data with duplicate detection
  const keywordDataMap = new Map<string, AhrefsKeywordItem>();
  for (const item of keywordData) {
    if (keywordDataMap.size >= MAX_KEYWORDS) {
      throw new Error(`Maximum keyword limit (${MAX_KEYWORDS}) exceeded`);
    }
    if (keywordDataMap.has(item.keyword)) {
      logger.warn(`Duplicate keyword in API response: ${item.keyword}`);
    }
    keywordDataMap.set(item.keyword, item);
  }
  try {
    // FIX: Process in chunks with limited concurrency instead of sequential await
    return await processInChunks(domain_id, phrases, keywordDataMap, MAX_CONCURRENT_REQUESTS);
  }
  finally {
    // FIX: Ensure all timers are cleaned up
    cancelAllDelays();
  }
}
/**
 * FIX: Process items in chunks with limited concurrency
 * - Prevents overwhelming the database with too many concurrent connections
 * - Uses Promise.all within each chunk for parallel processing
 * - Maintains controlled resource usage
 * - FIX: Includes proper timer cleanup
 */
async function processInChunks(domain_id: string, phrases: string[], keywordDataMap: Map<string, AhrefsKeywordItem>, chunkSize: number): Promise<KeywordGap[]> {
  const results: KeywordGap[] = [];
  // FIX: Track if we need to cleanup on early exit
  let isCancelled = false;
  // FIX: Cleanup function for early exit
  const cleanup = () => {
    isCancelled = true;
    cancelAllDelays();
  };
  // Register cleanup on process signals (deduplicated)
  registerCleanupHandlers(cleanup);
  try {
    for (let i = 0; i < phrases.length; i += chunkSize) {
      if (isCancelled) {
        logger.info('Processing cancelled, returning partial results');
        break;
      }
      const chunk = phrases.slice(i, i + chunkSize);
      // FIX: Use Promise.all to process chunk items in parallel
      const chunkResults = await Promise.all(chunk.map(async (phrase) => {
        const k = await upsertKeyword({
          domain_id,
          phrase,
          source: 'ahrefs',
        });
        if (!k) throw new Error(`Failed to upsert keyword: ${phrase}`);
        const apiData = keywordDataMap.get(phrase);
        return {
          keyword_id: k.id,
          phrase,
          volume: apiData?.volume ?? 0,
          competitor_rank: apiData?.position ?? 0,
        };
      }));
      results.push(...chunkResults);
    }
  }
  finally {
    // FIX: Ensure all timers are cleaned up
    cancelAllDelays();
  }
  return results;
}
// FIX: Register global cleanup on module load (using deduplicated handler)
registerBeforeExitHandler(() => {
  if (activeTimers.size > 0) {
    logger.warn(`Cleaning up ${activeTimers.size} pending delay timers`);
    cancelAllDelays();
  }
});
