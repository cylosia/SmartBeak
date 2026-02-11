/**
 * Shared validation types
 */

import type { FastifyReply } from 'fastify';
import type { ZodError } from 'zod';

/**
 * Validation Error class
 * Custom error for validation failures
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'VALIDATION_ERROR',
    public readonly details?: Array<{ path: (string | number)[]; message: string; code: string }>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Standard error response format
 */
export interface ValidationErrorResponse {
  error: 'Validation failed';
  code: 'VALIDATION_ERROR';
  details: Array<{
    path: (string | number)[];
    message: string;
    code: string;
  }>;
}

/**
 * Array validation options
 */
export interface ArrayValidationOptions {
  minLength?: number;
  maxLength?: number;
}
