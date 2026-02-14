/**
 * Shared validation types
 *
 * Re-exports canonical types from @errors for backward compatibility.
 */

// Re-export from canonical source
export { ValidationError } from '@errors';
export type { ErrorResponse as ValidationErrorResponse } from '@errors';

/**
 * Array validation options
 */
export interface ArrayValidationOptions {
  minLength?: number;
  maxLength?: number;
}
