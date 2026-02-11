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

  // Sort by length descending and truncate
  stringFields.sort((a, b) => b.length - a.length);
  const availableForStrings = maxSize - currentSize - (stringFields.length * 10); // 10 chars per key:'',

  for (const field of stringFields) {
    const maxFieldSize = Math.floor(availableForStrings / stringFields.length);
    if (field.length > maxFieldSize) {
      result[field.key] = field.value.substring(0, Math.floor(maxFieldSize / 2)) + '... [truncated]';
    } else {
      result[field.key] = field.value;
    }
  }

  return result as T;
}
