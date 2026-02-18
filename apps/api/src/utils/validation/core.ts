/**
 * Core validation functions
 */

import type { FastifyReply } from 'fastify';
import type { ZodError } from 'zod';
import { z } from 'zod';
import type { ArrayValidationOptions } from './types.js';
import { errors } from '@errors/responses';

// Re-export zod for convenience
export { z } from 'zod';

/**
 * Standard validation function for Zod errors
 * Returns the canonical error response format with HTTP 400 status
 */
export function handleZodError(error: ZodError, reply: FastifyReply): FastifyReply {
  const details = error.issues.map(issue => ({
    path: issue.path as (string | number)[],
    message: issue.message,
    code: issue.code as string
  }));
  return errors.validationFailed(reply, details);
}

/**
 * Parse and validate data with Zod schema, throwing on validation failure
 */
export function parseWithSchema<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

/**
 * Safely parse data with Zod schema, returning null on failure
 */
export function safeParseWithSchema<T>(schema: z.ZodSchema<T>, data: unknown): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Validates that a value is a non-empty string
 * @param value - The value to validate
 * @param name - The name of the field (for error messages)
 * @returns The trimmed string value
 * @throws Error if value is not a non-empty string
 */
export function validateNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} cannot be empty`);
  }
  return trimmed;
}

/**
 * Validates that a value is a valid URL string
 * @param url - The URL to validate
 * @param name - The name of the field (for error messages)
 * @returns The URL string
 * @throws Error if URL is invalid
 */
export function validateUrl(url: unknown, name: string): string {
  if (typeof url !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  try {
    new URL(url);
    return url;
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

/**
 * P2-FIX: Extracted from billingStripe.ts and billingPaddle.ts where it was
 * duplicated verbatim. A single canonical copy prevents the two routes drifting
 * when security fixes are applied to one but not the other.
 *
 * Strips any keys not in `allowed` from `input`, preventing mass-assignment.
 * Complements (rather than replaces) Zod `.strict()` which rejects unknown
 * fields at parse time — this function is a defence-in-depth runtime guard.
 */
export function whitelistFields<T extends Record<string, unknown>>(
  input: T,
  allowed: readonly string[]
): Partial<T> {
  const result: Partial<T> = {};
  for (const key of allowed) {
    if (key in input) {
      const k = key as keyof T;
      result[k] = input[k];
    }
  }
  return result;
}

/**
 * Validates that a value is an array with items matching a validator function
 * @param arr - The array to validate
 * @param validator - Function to validate each item
 * @param name - The name of the field (for error messages)
 * @param options - Optional validation constraints
 * @returns The validated array
 * @throws Error if array or items are invalid
 */
export function validateArray<T>(
  arr: unknown,
  validator: (item: unknown) => T,
  name: string,
  options: ArrayValidationOptions = {}
): T[] {
  if (!Array.isArray(arr)) {
    throw new Error(`${name} must be an array`);
  }
  
  if (options.minLength !== undefined && arr.length < options.minLength) {
    throw new Error(`${name} must have at least ${options.minLength} items`);
  }
  
  if (options.maxLength !== undefined && arr.length > options.maxLength) {
    throw new Error(`${name} must have at most ${options.maxLength} items`);
  }
  
  return arr.map((item, index) => {
    try {
      return validator(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Validation failed';
      throw new Error(`${name}[${index}]: ${message}`);
    }
  });
}
