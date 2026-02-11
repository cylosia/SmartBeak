/**
 * Base Types for Validation
 * 
 * Minimal types needed to avoid circular dependencies.
 * This file should not import from other validation modules.
 */

// ============================================================================
// Error Code Constants
// ============================================================================

export const ErrorCodes = {
  // Validation Errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_PARAMS: 'INVALID_PARAMS',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_UUID: 'INVALID_UUID',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_URL: 'INVALID_URL',
  INVALID_DATE: 'INVALID_DATE',
  INVALID_RANGE: 'INVALID_RANGE',
  INVALID_LENGTH: 'INVALID_LENGTH',
  REQUIRED_FIELD: 'REQUIRED_FIELD',

  // Authentication Errors
  AUTH_ERROR: 'AUTH_ERROR',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHORIZED: 'UNAUTHORIZED',

  // Resource Errors
  NOT_FOUND: 'NOT_FOUND',
  CONTENT_NOT_FOUND: 'CONTENT_NOT_FOUND',
  DOMAIN_NOT_FOUND: 'DOMAIN_NOT_FOUND',
  INTENT_NOT_FOUND: 'INTENT_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',

  // Domain/Ownership Errors
  DOMAIN_NOT_OWNED: 'DOMAIN_NOT_OWNED',
  ACCESS_DENIED: 'ACCESS_DENIED',

  // Database Errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  DUPLICATE_KEY: 'DUPLICATE_KEY',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  QUERY_TIMEOUT: 'QUERY_TIMEOUT',

  // Service Errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',

  // Business Logic Errors
  PUBLISH_FAILED: 'PUBLISH_FAILED',
  INTENT_RETRIEVAL_FAILED: 'INTENT_RETRIEVAL_FAILED',
  BILLING_ERROR: 'BILLING_ERROR',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',

  // Method Errors
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',

  // JSONB/Size Errors
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  JSONB_SIZE_EXCEEDED: 'JSONB_SIZE_EXCEEDED',

  // Conflict Errors
  CONFLICT: 'CONFLICT',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',

  // External API Errors
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// ============================================================================
// Base Validation Error
// ============================================================================

export class ValidationError extends Error {
  public readonly code: ErrorCode;
  public readonly field: string | undefined;

  constructor(message: string, field: string | undefined = undefined, code: ErrorCode = ErrorCodes.VALIDATION_ERROR) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.field = field;

    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, ValidationError.prototype);
  }

  toJSON(): { message: string; code: ErrorCode; field?: string } {
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
  public readonly code: ErrorCode;
  public readonly details: Record<string, unknown> | undefined;
  public readonly context: Record<string, unknown> | undefined;
  public override readonly cause: Error | undefined;

  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.EXTERNAL_API_ERROR,
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

  toJSON(): { message: string; code: ErrorCode; details?: Record<string, unknown>; context?: Record<string, unknown> } {
    return {
      message: this.message,
      code: this.code,
      ...(this.details && { details: this.details }),
      ...(this.context && { context: this.context }),
    };
  }
}
