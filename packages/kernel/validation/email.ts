/**
 * Email Validation - MEDIUM FIX I6: Add format validation
 */

import { z } from 'zod';

/** Email validation regex - MEDIUM FIX I6: Add format validation */
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Email validation schema with format validation
 * MEDIUM FIX I6: Add format validation
 */
export const EmailSchema = z.string()
  .email()
  .max(255)
  .toLowerCase()
  .trim()
  .refine((email) => EMAIL_REGEX.test(email), {
    message: 'Invalid email format'
  });

/**
 * Validate email format
 * @param email - Email to validate
 * @returns True if valid email format
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email) && email.length <= 255;
}

/**
 * Normalize email address
 * @param email - Email to normalize
 * @returns Normalized email (lowercase, trimmed)
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}
