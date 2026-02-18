/**
 * P2-MEDIUM FIX: JSONB Size Validation
 */

/** Maximum JSONB size in bytes (1MB) */
export const MAX_JSONB_SIZE = 1024 * 1024;

/** Maximum JSONB size in bytes for large fields (10MB) */
export const MAX_JSONB_SIZE_LARGE = 10 * 1024 * 1024;

/**
 * Validate JSONB data size before insertion
 * @param data - Data to validate
 * @param maxSize - Maximum allowed size in bytes
 * @throws Error if data exceeds maximum size
 */
export function validateJSONBSize(data: unknown, maxSize: number = MAX_JSONB_SIZE): void {
  const jsonString = JSON.stringify(data);
  const sizeInBytes = Buffer.byteLength(jsonString, 'utf8');

  if (sizeInBytes > maxSize) {
    throw new Error(
      `JSONB data exceeds maximum size of ${maxSize} bytes ` +
      `(got ${sizeInBytes} bytes, ${jsonString.length} characters)`
    );
  }
}

/**
 * Safely serialize data for JSONB storage with size validation
 * @param data - Data to serialize
 * @param maxSize - Maximum allowed size in bytes
 * @returns JSON string
 * @throws Error if data exceeds maximum size
 */
export function serializeForJSONB(data: unknown, maxSize: number = MAX_JSONB_SIZE): string {
  validateJSONBSize(data, maxSize);
  return JSON.stringify(data);
}

/**
 * Check if data would fit in JSONB without throwing
 * @param data - Data to check
 * @param maxSize - Maximum allowed size in bytes
 * @returns True if data fits, false otherwise
 */
export function wouldFitInJSONB(data: unknown, maxSize: number = MAX_JSONB_SIZE): boolean {
  try {
    validateJSONBSize(data, maxSize);
    return true;
  } catch {
    return false;
  }
}

/**
 * Truncate JSONB data to fit within size limit
 * @param data - Data to truncate
 * @param maxSize - Maximum allowed size in bytes
 * @returns Truncated data
 */
export function truncateJSONB<T extends Record<string, unknown>>(
  data: T,
  maxSize: number = MAX_JSONB_SIZE
): T {
  const jsonString = JSON.stringify(data);
  const sizeInBytes = Buffer.byteLength(jsonString, 'utf8');

  if (sizeInBytes <= maxSize) {
    return data;
  }

  // For objects with string values, truncate the longest strings first
  const result: Record<string, unknown> = {};
  const stringFields: Array<{ key: string; value: string; length: number }> = [];
  let currentSize = 2; // For {} brackets

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      stringFields.push({ key, value, length: Buffer.byteLength(value, 'utf8') });
    } else {
      result[key] = value;
      currentSize += Buffer.byteLength(JSON.stringify({ [key]: value }), 'utf8') - 2;
    }
  }

  // Sort by length descending and truncate.
  // The previous fixed-overhead approach (10 bytes per field) underestimated
  // overhead for long key names, allowing the result to still exceed maxSize.
  // Instead, greedily fill fields and measure actual remaining budget each time.
  stringFields.sort((a, b) => b.length - a.length);

  for (const field of stringFields) {
    // Measure how many bytes the partial result already occupies.
    const serializedSoFar = Buffer.byteLength(JSON.stringify(result), 'utf8');
    // Exact overhead for `,"key":""` (subtract 2 for the surrounding `{}` in JSON.stringify).
    const keyOverheadBytes = Buffer.byteLength(JSON.stringify({ [field.key]: '' }), 'utf8') - 2;
    const remainingBudget = maxSize - serializedSoFar - keyOverheadBytes;
    if (remainingBudget <= 0) {
      break; // No budget left for any more string fields
    }
    if (field.length > remainingBudget) {
      // Leave room for the `... [truncated]` suffix (15 bytes)
      const keepBytes = Math.max(0, remainingBudget - 15);
      result[field.key] = field.value.substring(0, keepBytes) + '... [truncated]';
    } else {
      result[field.key] = field.value;
    }
  }

  // Final safety guard: if estimation is still off, hard-truncate by removing
  // the largest remaining string field until the object fits.
  let finalJson = JSON.stringify(result);
  while (Buffer.byteLength(finalJson, 'utf8') > maxSize && Object.keys(result).length > 0) {
    const longestKey = Object.keys(result).reduce((a, b) =>
      Buffer.byteLength(String(result[a]), 'utf8') > Buffer.byteLength(String(result[b]), 'utf8') ? a : b
    );
    delete result[longestKey];
    finalJson = JSON.stringify(result);
  }

  return result as T;
}
