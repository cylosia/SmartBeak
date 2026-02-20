/**
 * JSONB Size Validation
 */

import { ValidationError } from './types-base';

/** Maximum JSONB size in bytes (1MB) */
export const MAX_JSONB_SIZE = 1024 * 1024;

/** Maximum JSONB size in bytes for large fields (10MB) */
export const MAX_JSONB_SIZE_LARGE = 10 * 1024 * 1024;

/** Maximum object nesting depth to prevent stack overflow */
const MAX_DEPTH = 50;

/** Maximum number of keys per object to prevent DoS */
const MAX_KEYS = 10000;

/**
 * AUDIT-FIX C3: Sanitize data before JSON.stringify to prevent malicious toJSON()
 * execution. JSON.stringify invokes toJSON() on objects, which can execute arbitrary
 * code if the input is attacker-controlled (e.g., via prototype pollution or
 * deserialized payloads). This function rejects objects with toJSON methods and
 * enforces depth/key-count limits.
 */
function sanitizeForStringify(data: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    throw new ValidationError('JSONB data exceeds maximum nesting depth', 'jsonb');
  }

  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  // Reject objects with toJSON method (prevents arbitrary code execution)
  if ('toJSON' in (data as object) && typeof (data as Record<string, unknown>)['toJSON'] === 'function') {
    throw new ValidationError('JSONB data contains toJSON method which is not allowed', 'jsonb');
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForStringify(item, depth + 1));
  }

  const keys = Object.keys(data as object);
  if (keys.length > MAX_KEYS) {
    throw new ValidationError(`JSONB data exceeds maximum key count of ${MAX_KEYS}`, 'jsonb');
  }

  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = sanitizeForStringify((data as Record<string, unknown>)[key], depth + 1);
  }
  return result;
}

/**
 * Safe JSON.stringify that sanitizes input first.
 * Prevents toJSON() execution, validates depth, and handles circular refs.
 */
function safeStringify(data: unknown): string {
  const sanitized = sanitizeForStringify(data);
  return JSON.stringify(sanitized);
}

/**
 * Calculate JSONB size in bytes
 * @param data - Data to measure
 * @returns Size in bytes
 */
export function calculateJSONBSize(data: unknown): number {
  // P0-FIX: Wrap in try/catch. A circular reference throws
  // "TypeError: Converting circular structure to JSON" which was previously
  // unhandled, crashing any caller (e.g. request logging middleware).
  let jsonString: string;
  try {
    // AUDIT-FIX C3: Use safeStringify to prevent malicious toJSON() execution.
    jsonString = safeStringify(data);
  } catch {
    // Treat un-serialisable data (circular refs, BigInt, etc.) as max size
    // so callers reject it rather than silently storing corrupt JSONB.
    return Number.MAX_SAFE_INTEGER;
  }
  // P2-2 FIX: Standardize on Buffer.byteLength for UTF-8 size calculation.
  return Buffer.byteLength(jsonString, 'utf8');
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
    // AUDIT-FIX L9: Safe access instead of non-null assertion.
    throw new ValidationError(result["error"] ?? 'JSONB validation failed', 'jsonb');
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
  // AUDIT-FIX C3: Use safeStringify to prevent malicious toJSON() execution.
  let jsonString: string;
  try {
    jsonString = safeStringify(data);
  } catch (err) {
    throw new Error(
      `Data cannot be serialized to JSON: ${err instanceof Error ? err.message : String(err)}`
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
// P2-9 FIX: Return type changed from T to Record<string, unknown>.
export function truncateJSONB(
  data: Record<string, unknown>,
  maxSize: number = MAX_JSONB_SIZE
): Record<string, unknown> {
  // AUDIT-FIX C3: Use safeStringify to prevent malicious toJSON() execution.
  let jsonString: string;
  try {
    jsonString = safeStringify(data);
  } catch {
    return { _error: 'Data cannot be serialized to JSON' };
  }
  const sizeInBytes = Buffer.byteLength(jsonString, 'utf8');

  if (sizeInBytes <= maxSize) {
    // AUDIT-FIX L8: Return a shallow copy to prevent callers from mutating
    // the original data through the returned reference.
    return { ...data };
  }

  // AUDIT-FIX H25: Pre-compute non-string field sizes from the already-serialized
  // JSON string to avoid quadratic O(N * avg_value_size) re-serialization.
  // We serialize the full object once above and work from that.
  const result: Record<string, unknown> = {};
  const stringFields: Array<{ key: string; value: string; length: number }> = [];
  let nonStringSize = 2; // For {} brackets

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      stringFields.push({ key, value, length: Buffer.byteLength(value, 'utf8') });
    } else {
      result[key] = value;
      // Account for key, quotes, colon, comma overhead
      const keyOverhead = Buffer.byteLength(JSON.stringify(key), 'utf8') + 1; // "key":
      let valSize: number;
      try {
        valSize = Buffer.byteLength(JSON.stringify(value), 'utf8');
      } catch {
        valSize = 4; // "null" fallback
        result[key] = null;
      }
      nonStringSize += keyOverhead + valSize + 1; // +1 for comma
    }
  }

  // Sort by length descending and truncate
  stringFields.sort((a, b) => b.length - a.length);
  const availableForStrings = maxSize - nonStringSize;

  if (stringFields.length > 0) {
    const perFieldBudget = Math.floor(availableForStrings / stringFields.length);
    for (const field of stringFields) {
      // Account for key overhead: "key":"value",
      const keyOverhead = Buffer.byteLength(JSON.stringify(field.key), 'utf8') + 3; // "key":"",
      const valueBudget = Math.max(0, perFieldBudget - keyOverhead);
      if (field.length > valueBudget && valueBudget > 20) {
        result[field.key] = field.value.substring(0, Math.floor(valueBudget / 2)) + '... [truncated]';
      } else if (valueBudget <= 20) {
        result[field.key] = '... [truncated]';
      } else {
        result[field.key] = field.value;
      }
    }
  }

  // P2-3 FIX: Post-truncation size validation.
  const finalSize = Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (finalSize > maxSize) {
    return { _truncated: true, _error: `Data exceeded ${maxSize} bytes after truncation` };
  }

  return result;
}
