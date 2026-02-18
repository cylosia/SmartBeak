/**
 * JSONB Size Validation
 */

import { ValidationError } from './types-base';

/** Maximum JSONB size in bytes (1MB) */
export const MAX_JSONB_SIZE = 1024 * 1024;

/** Maximum JSONB size in bytes for large fields (10MB) */
export const MAX_JSONB_SIZE_LARGE = 10 * 1024 * 1024;

/**
 * Calculate JSONB size in bytes
 * @param data - Data to measure
 * @returns Size in bytes
 */
export function calculateJSONBSize(data: unknown): number {
  // P1-10 FIX: JSON.stringify throws TypeError for circular references.
  // Propagate as a clear ValidationError rather than an unhandled crash.
  let jsonString: string;
  try {
    jsonString = JSON.stringify(data);
  } catch (err) {
    throw new ValidationError(
      `Cannot calculate JSONB size: ${err instanceof Error ? err.message : String(err)}`,
      'jsonb'
    );
  }
  // Use a conservative estimate for UTF-8 encoding
  let size = 0;
  for (let i = 0; i < jsonString.length; i++) {
    const code = jsonString.charCodeAt(i);
    if (code <= 0x7f) {
      size += 1;
    } else if (code <= 0x7ff) {
      size += 2;
    } else if (code >= 0xd800 && code <= 0xdfff) {
      // Surrogate pair
      size += 4;
      i++;
    } else {
      size += 3;
    }
  }
  return size;
}

/**
 * Validate JSONB data size
 * @param data - Data to validate
 * @param maxSize - Maximum allowed size in bytes
 * @returns Validation result
 */
export function validateJSONBSize(data: unknown, maxSize: number = MAX_JSONB_SIZE): {
  valid: boolean;
  size: number;
  error?: string;
} {
  const size = calculateJSONBSize(data);

  if (size > maxSize) {
    return {
      valid: false,
      error: `JSONB size ${size} bytes exceeds maximum of ${maxSize} bytes`,
      size,
    };
  }

  return { valid: true, size };
}

/**
 * Assert JSONB size is within limits
 * @param data - Data to validate
 * @param maxSize - Maximum allowed size
 * @throws ValidationError if size exceeds limit
 */
export function assertJSONBSize(data: unknown, maxSize: number = MAX_JSONB_SIZE): void {
  const result = validateJSONBSize(data, maxSize);
  if (!result.valid) {
    throw new ValidationError(result["error"]!, 'jsonb');
  }
}

/**
 * Check if value would fit in JSONB
 * @param data - Data to check
 * @param maxSize - Maximum allowed size
 * @returns True if data fits
 */
export function fitsInJSONB(data: unknown, maxSize: number = MAX_JSONB_SIZE): boolean {
  return validateJSONBSize(data, maxSize).valid;
}

/**
 * Safely serialize data for JSONB storage with size validation
 * @param data - Data to serialize
 * @param maxSize - Maximum allowed size in bytes
 * @returns JSON string
 * @throws Error if data exceeds maximum size
 */
export function serializeForJSONB(data: unknown, maxSize: number = MAX_JSONB_SIZE): string {
  // P2-8 FIX: Serialize once instead of twice. Previously, validateJSONBSize
  // called JSON.stringify internally, and then we called JSON.stringify again
  // here. For large payloads, this doubled CPU and memory usage.
  // P1-10 FIX: Guard against circular references.
  let jsonString: string;
  try {
    jsonString = JSON.stringify(data);
  } catch (err) {
    throw new ValidationError(
      `Cannot serialize for JSONB: ${err instanceof Error ? err.message : String(err)}`,
      'jsonb'
    );
  }
  const size = Buffer.byteLength(jsonString, 'utf8');

  if (size > maxSize) {
    throw new Error(`JSONB size ${size} bytes exceeds maximum of ${maxSize} bytes`);
  }

  return jsonString;
}

/**
 * Truncate JSONB data to fit within size limit
 * @param data - Data to truncate
 * @param maxSize - Maximum allowed size in bytes
 * @returns Truncated data
 */
// P2-9 FIX: Return type changed from T to Record<string, unknown>. The function
// constructs a new object that doesn't match T's shape, so the previous `as T`
// cast was a type-lie to callers.
export function truncateJSONB(
  data: Record<string, unknown>,
  maxSize: number = MAX_JSONB_SIZE
): Record<string, unknown> {
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

  return result;
}
