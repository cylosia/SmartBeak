import { getLogger } from '@kernel/logger';
import { z } from 'zod';

/**
* MEDIUM FIX M1: Added input validation and error handling
* - Validates input is an array
* - Handles null/undefined records gracefully
* - Provides proper error messages
*/

/** Logger for attribution analytics */
const logger = getLogger('attribution-analytics');

const AttributionRecordSchema = z.object({
  impressions: z.number().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  clicks: z.number().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  views: z.number().min(0).max(Number.MAX_SAFE_INTEGER).default(0)
});

const MAX_RECORDS = 100000;

export function summarizeAttribution(records: unknown[]): { impressions: number; clicks: number; views: number } {
  // Validate input is an array
  if (!Array.isArray(records)) {
  throw new Error('Invalid input: records must be an array');
  }

  // Add maximum array length check to prevent memory issues
  if (records.length > MAX_RECORDS) {
  throw new Error(`Too many records: ${records.length} exceeds maximum of ${MAX_RECORDS}`);
  }

  try {
  return records.reduce((acc: { impressions: number; clicks: number; views: number }, r, index) => {
    // Handle null/undefined record entries
    if (r === null || r === undefined) {
    logger.warn(`[summarizeAttribution] Null/undefined record at index ${index}`);
    return acc;
    }

    // Validate record structure using Zod schema
    const result = AttributionRecordSchema.safeParse(r);
    if (!result.success) {
    logger.warn(`[summarizeAttribution] Invalid record at index ${index}:`, result.error.format());
    return acc;
    }

    const { impressions, clicks, views } = result.data;

    acc.impressions += impressions;
    acc.clicks += clicks;
    acc.views += views;
    return acc;
  }, { impressions: 0, clicks: 0, views: 0 });
  } catch (error) {
  // Error handling for unexpected errors
  logger.error('[summarizeAttribution] Error during aggregation:', error as Error);
  throw new Error(`Failed to summarize attribution: ${error instanceof Error ? error["message"] : 'Unknown error'}`);
  }
}
