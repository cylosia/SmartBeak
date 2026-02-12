/**
 * Common Schemas - MEDIUM FIX I1-I8: Input validation improvements
 */

import { z } from 'zod';
import {} from './types-base';

/** URL validation regex - MEDIUM FIX I3: Add URL encoding validation */
const URL_REGEX = /^https?:\/\/(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?::\d{1,5})?(?:\/[^\s]*)?$/;

// ============================================================================
// Query Schemas - MEDIUM FIX I1: Add validation on query parameters
// ============================================================================

/**
 * Pagination query schema with validation
 * MEDIUM FIX I1: Add validation on query parameters
 * MEDIUM FIX I5: Add range validation
 */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1)
    .refine((n) => n <= 100000, { message: 'Page number too large' }),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

/** Pagination query type */
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Search query schema with validation
 * MEDIUM FIX I1: Add validation on query parameters
 * MEDIUM FIX I6: Add format validation
 */
const SortEnumSchema = z.union([
  z.literal('relevance'),
  z.literal('date'),
  z.literal('name'),
]);

export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200).transform(sanitizeSearchQuery),
  filters: z.record(z.string(), z.string()).optional(),
  sort: SortEnumSchema.default('relevance'),
});

/** Search query type */
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

// ============================================================================
// Date Validation - MEDIUM FIX I4: Add date validation
// ============================================================================

/**
 * Date range schema with validation
 * MEDIUM FIX I4: Add date validation
 */
export const DateRangeSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
}).refine(
  (data) => data.startDate <= data.endDate,
  { message: 'startDate must be before or equal to endDate' }
);

/** Date range type */
export type DateRange = z.infer<typeof DateRangeSchema>;

/** Valid date range (reasonable bounds) */
const MIN_VALID_YEAR = 1970;
const MAX_VALID_YEAR = 2100;

/**
 * Validate date is within reasonable bounds
 * MEDIUM FIX I4: Add date validation
 *
 * @param date - Date to validate
 * @returns True if date is valid
 */
export function isValidDate(date: Date | string | number): boolean {
  if (date === null || date === undefined) return false;

  const d = new Date(date);
  if (isNaN(d.getTime())) return false;

  const year = d.getUTCFullYear();
  return year >= MIN_VALID_YEAR && year <= MAX_VALID_YEAR;
}

/**
 * Normalize date to ISO string with validation
 * MEDIUM FIX I4: Add date validation
 *
 * @param date - Date to normalize
 * @returns ISO string representation
 * @throws ValidationError if invalid date
 */
export function normalizeDate(date: Date | string | number): string {
  if (date === null || date === undefined) {
    throw new Error('Date is required');
  }

  const d = new Date(date);
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date format');
  }

  // Validate date range (reasonable bounds)
  const year = d.getUTCFullYear();
  if (year < MIN_VALID_YEAR || year > MAX_VALID_YEAR) {
    throw new Error(
      `Date out of valid range (${MIN_VALID_YEAR}-${MAX_VALID_YEAR})`
    );
  }

  return d.toISOString();
}

// ============================================================================
// Money Validation
// ============================================================================

/**
 * Money amount schema (in cents) with range validation
 * MEDIUM FIX I5: Add range validation
 */
export const MoneyCentsSchema = z.number()
  .int()
  .min(0)
  .max(999999999)
  .refine((n) => !isNaN(n) && isFinite(n), {
    message: 'Money amount must be a valid number'
  });

/** Money cents type */
export type MoneyCents = z.infer<typeof MoneyCentsSchema>;

/**
 * Convert dollars to cents safely with validation
 * MEDIUM FIX I5: Add range validation
 *
 * @param dollars - Amount in dollars
 * @returns Amount in cents
 * @throws Error if invalid amount
 */
export function dollarsToCents(dollars: number): number {
  if (typeof dollars !== 'number' || isNaN(dollars) || !isFinite(dollars)) {
    throw new Error(
      'Invalid dollar amount: must be a valid number'
    );
  }

  if (dollars < 0) {
    throw new Error(
      'Dollar amount cannot be negative'
    );
  }
  if (dollars > 99999999.99) {
    throw new Error(
      'Dollar amount exceeds maximum'
    );
  }

  return Math.round(dollars * 100);
}

/**
 * Convert cents to dollars for display with validation
 * MEDIUM FIX I5: Add range validation
 *
 * @param cents - Amount in cents
 * @returns Amount in dollars
 * @throws Error if invalid amount
 */
export function centsToDollars(cents: number): number {
  if (typeof cents !== 'number' || isNaN(cents) || !isFinite(cents)) {
    throw new Error(
      'Invalid cent amount: must be a valid number'
    );
  }

  if (cents < 0) {
    throw new Error(
      'Cent amount cannot be negative'
    );
  }
  if (cents > 9999999999) {
    throw new Error(
      'Cent amount exceeds maximum'
    );
  }

  return cents / 100;
}

// ============================================================================
// URL Validation Schema - MEDIUM FIX I3/I6
// ============================================================================

/**
 * URL validation schema with encoding validation
 * MEDIUM FIX I3: Add URL encoding validation
 * MEDIUM FIX I6: Add format validation
 */
export const UrlSchema = z.string()
  .url()
  .max(2000)
  .refine((url) => URL_REGEX.test(url), {
    message: 'Invalid URL format'
  })
  .refine((url) => {
    // Check for valid URL encoding
    try {
      decodeURIComponent(url);
      return true;
    } catch {
      return false;
    }
  }, {
    message: 'URL contains invalid encoding'
  });

// ============================================================================
// Enum Validation - MEDIUM FIX I8: Add enum validation
// ============================================================================

/**
 * Create a schema for string enums
 * MEDIUM FIX I8: Add enum validation
 *
 * @param values - Valid enum values
 * @returns Zod schema for enum validation
 */
export function createEnumSchema<T extends string>(values: readonly T[]) {
  return z.enum(values as [T, ...T[]]);
}

/**
 * Validate value is in enum
 * MEDIUM FIX I8: Add enum validation
 *
 * @param value - Value to validate
 * @param validValues - Valid enum values
 * @param fieldName - Name of the field
 * @returns Validated enum value
 * @throws Error if invalid
 */
export function validateEnum<T extends string>(
  value: unknown,
  validValues: readonly T[],
  fieldName: string = 'value'
): T {
  if (typeof value !== 'string') {
    throw new Error(
      `${fieldName} must be a string`
    );
  }

  if (!validValues.includes(value as T)) {
    throw new Error(
      `${fieldName} must be one of: ${validValues.join(', ')}`
    );
  }

  return value as T;
}

// ============================================================================
// String Validation - MEDIUM FIX I5: Add length validation
// ============================================================================

/**
 * Sanitize search query
 * Removes special characters that could cause issues
 * MEDIUM FIX I6: Add format validation
 *
 * @param query - Query string to sanitize
 * @returns Sanitized query string
 */
export function sanitizeSearchQuery(query: string): string {
  // Validate input type
  if (typeof query !== 'string') {
    return '';
  }

  // Remove SQL-like wildcards for security
  let sanitized = query
    .replace(/[%_]/g, '') // SQL wildcards
    .replace(/[<>]/g, '') // HTML tags
    .replace(/[*?]/g, '') // File globs
    .trim();

  // Limit length
  if (sanitized.length > 200) {
    sanitized = sanitized.slice(0, 200);
  }

  return sanitized;
}

/**
 * Validate array length
 * MEDIUM FIX I5: Add length validation
 *
 * @param arr - Array to validate
 * @param maxLength - Maximum allowed length
 * @param fieldName - Name of the field (for error message)
 * @returns The validated array
 * @throws Error if invalid
 */
export function validateArrayLength<T>(
  arr: T[],
  maxLength: number,
  fieldName: string = 'array'
): T[] {
  // Clamp maxLength
  const clampedMaxLength = Math.min(Math.max(1, maxLength), 100000);

  if (!Array.isArray(arr)) {
    throw new Error(
      `${fieldName} must be an array`
    );
  }
  if (arr.length > clampedMaxLength) {
    throw new Error(
      `${fieldName} exceeds maximum length of ${clampedMaxLength} (got ${arr.length})`
    );
  }
  return arr;
}

/**
 * Validate string length
 * MEDIUM FIX I5: Add length validation
 *
 * @param str - String to validate
 * @param min - Minimum length
 * @param max - Maximum length
 * @param fieldName - Name of the field (for error message)
 * @returns The validated string
 * @throws Error if invalid
 */
export function validateStringLength(
  str: string,
  min: number,
  max: number,
  fieldName: string = 'string'
): string {
  // Clamp min/max
  const clampedMin = Math.max(0, min);
  const clampedMax = Math.min(Math.max(clampedMin, max), 100000);

  if (typeof str !== 'string') {
    throw new Error(
      `${fieldName} must be a string`
    );
  }
  if (str.length < clampedMin) {
    throw new Error(
      `${fieldName} is too short (min ${clampedMin}, got ${str.length})`
    );
  }
  if (str.length > clampedMax) {
    throw new Error(
      `${fieldName} is too long (max ${clampedMax}, got ${str.length})`
    );
  }
  return str;
}

/**
 * Validate non-empty string
 * MEDIUM FIX I5: Add length validation
 *
 * @param value - Value to validate
 * @param fieldName - Name of the field (for error message)
 * @returns The validated string
 * @throws Error if invalid
 */
export function validateNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `${fieldName} must be a non-empty string`
    );
  }
  return value.trim();
}
