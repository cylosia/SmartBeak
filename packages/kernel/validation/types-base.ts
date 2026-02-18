/**
 * Base Types for Validation
 *
 * Re-exports the canonical ErrorCodes and ErrorCode type from @errors.
 * Local error classes (ExternalAPIError) are kept here because they serve
 * the kernel validation layer specifically.
 *
 * P1-3 FIX: The local ValidationError class has been removed. It duplicated
 * the canonical ValidationError from @errors, causing instanceof checks to
 * fail silently across package boundaries (the two classes share a name but
 * have different prototype chains). All code must import ValidationError from
 * @errors, which is the single source of truth.
 */

// Re-export canonical error codes and ValidationError from @errors (single source of truth)
export { ErrorCodes, type ErrorCode, ValidationError } from '@errors';

/**
 * External API Error
 * Used for errors from external API calls
 *
 * P2-5 FIX: cause is typed as `unknown` to match the ES2022 Error.cause
 * built-in type. Narrowing to `Error | undefined` was contravariant against
 * the platform type and could break tools that read .cause as unknown.
 */
export class ExternalAPIError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown> | undefined;
  public override readonly cause: unknown;
  public readonly context: Record<string, unknown> | undefined;

  constructor(
    message: string,
    code: string = 'EXTERNAL_API_ERROR',
    details: Record<string, unknown> | undefined = undefined,
    cause: unknown = undefined,
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
