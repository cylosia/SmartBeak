/**
 * Email Validation - MEDIUM FIX I6: Add format validation
 */

import { z } from 'zod';

/** Validate the local part of an email (before @) — no nested quantifiers */
const EMAIL_LOCAL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/;

/** Validate a single domain label (1-63 chars, alphanumeric + hyphens, no leading/trailing hyphen) */
function isValidDomainLabel(label: string): boolean {
  if (label.length < 1 || label.length > 63) return false;
  if (!/^[a-zA-Z0-9]/.test(label)) return false;
  if (!/[a-zA-Z0-9]$/.test(label)) return false;
  return /^[a-zA-Z0-9-]+$/.test(label);
}

/** Check email format by validating parts separately to avoid ReDoS */
function isValidEmailFormat(email: string): boolean {
  const atIndex = email.indexOf('@');
  if (atIndex < 1 || atIndex === email.length - 1) return false;
  if (email.indexOf('@', atIndex + 1) !== -1) return false;

  const local = email.substring(0, atIndex);
  const domain = email.substring(atIndex + 1);

  if (!EMAIL_LOCAL_REGEX.test(local)) return false;

  const labels = domain.split('.');
  if (labels.length < 2) return false;

  return labels.every(label => isValidDomainLabel(label));
}

/**
 * Email validation schema with format validation
 * MEDIUM FIX I6: Add format validation
 */
export const EmailSchema = z.string()
  .email()
  .max(255)
  .toLowerCase()
  .trim()
  .refine((email) => isValidEmailFormat(email), {
    message: 'Invalid email format'
  });

/**
 * Validate email format.
 *
 * P1-CORRECTNESS FIX: Normalize (lowercase + trim) before validating to match
 * what `EmailSchema` does. Previously `isValidEmail` checked the raw string
 * while `EmailSchema` applied `.toLowerCase().trim()` first, producing
 * inconsistent accept/reject decisions for the same input address.
 *
 * @param email - Email to validate
 * @returns True if valid email format
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  const normalized = email.toLowerCase().trim();
  return normalized.length <= 255 && isValidEmailFormat(normalized);
}

/**
 * Normalize email address
 * @param email - Email to normalize
 * @returns Normalized email (lowercase, trimmed)
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}
