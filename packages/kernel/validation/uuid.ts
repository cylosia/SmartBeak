/**
 * UUID Validation - MEDIUM FIX I2: Standardize UUID validation
 */

import { z } from 'zod';
import * as crypto from 'crypto';
import { ValidationError, ErrorCodes } from './types-base';

/** UUID validation regex - MEDIUM FIX I2: Standardize UUID validation */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format
 * P1-FIX: Runtime validation for branded types
 * @param id - ID to validate
 * @returns True if valid UUID format
 */
export function isValidUUID(id: string): boolean {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

/**
 * Validate UUID or throw error
 * MEDIUM FIX I2: Standardize UUID validation
 * MEDIUM FIX E8: Add proper error message formatting
 *
 * @param str - String to validate
 * @param fieldName - Name of the field (for error message)
 * @returns The validated UUID string
 * @throws ValidationError if invalid
 */
export function validateUUID(str: string, fieldName: string = 'id'): string {
  if (!isValidUUID(str)) {
    throw new ValidationError(
      `Invalid ${fieldName} format: expected valid UUID (e.g., 550e8400-e29b-41d4-a716-446655440000)`,
      fieldName,
      ErrorCodes.INVALID_UUID
    );
  }
  return str;
}

/**
 * UUID schema for Zod validation
 */
export const UUIDSchema = z.string().refine(
  (val) => isValidUUID(val),
  { message: 'Invalid UUID format' }
);

/**
 * Normalize UUID to standard format
 * @param id - UUID string to normalize
 * @returns Normalized UUID
 */
export function normalizeUUID(id: string): string {
  return id.toLowerCase().trim();
}

/**
 * Generate a new UUID v4
 * @returns New UUID string
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}
