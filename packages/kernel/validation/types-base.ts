/**
 * Base Types for Validation
 *
 * Re-exports the canonical ErrorCodes and ErrorCode type from @errors.
 * Local error classes (ValidationError, ExternalAPIError) are kept here
 * because they serve the kernel validation layer specifically.
 */

// Re-export canonical error codes from @errors (single source of truth)
export { ErrorCodes, type ErrorCode } from '@errors';

// ============================================================================
// Base Validation Error
// ============================================================================

export class ValidationError extends Error {
  public readonly code: string;
  public readonly field: string | undefined;

  constructor(message: string, field: string | undefined = undefined, code: string = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.field = field;

    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, ValidationError.prototype);
  }

  toJSON(): { message: string; code: string; field?: string } {
    return {
      message: this.message,
      code: this.code,
      ...(this.field && { field: this.field }),
    };
  }
}

/**
 * External API Error
 * Used for errors from external API calls
 */
export class ExternalAPIError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown> | undefined;
  public override readonly cause: Error | undefined;
  public readonly context: Record<string, unknown> | undefined;

  constructor(
    message: string,
    code: string = 'EXTERNAL_API_ERROR',
    details: Record<string, unknown> | undefined = undefined,
    cause: Error | undefined = undefined,
    context: Record<string, unknown> | undefined = undefined
  ) {
    super(message);
    this.name = 'ExternalAPIError';
    this.code = code;
    this.details = details;
    this.cause = cause;
    this.context = context;

    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, ExternalAPIError.prototype);
  }

  toJSON(): { message: string; code: string; details?: Record<string, unknown>; context?: Record<string, unknown> } {
    return {
      message: this.message,
      code: this.code,
      ...(this.details && { details: this.details }),
      ...(this.context && { context: this.context }),
    };
  }
}
