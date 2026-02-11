/**
 * Shared Validation Errors
 * Error classes for validation failures
 */

/**
 * Validation Error class
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'VALIDATION_ERROR',
    public readonly field?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
