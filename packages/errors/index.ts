
import { getLogger } from '@kernel/logger';

const logger = getLogger('errors');

/**
* Unified Error Handling Package
*
* Provides standardized error classes, error codes, and response helpers
* for consistent error handling across all API routes.
*
* Standard Error Format:
* {
*   error: string;       // Human-readable error message
*   code: string;        // Machine-readable error code
*   details?: unknown;   // Additional error details (validation issues, etc.)
*   requestId?: string;  // Request ID for tracing
* }
*
* P2-MEDIUM FIXES:
* - Enhanced DB error sanitization
* - NODE_ENV checks for error details
* - Complete error message mapping
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
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  MISSING_PARAMETER: 'MISSING_PARAMETER',

  // Authentication Errors
  AUTH_ERROR: 'AUTH_ERROR',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  FORBIDDEN: 'FORBIDDEN',

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
  STRIPE_ERROR: 'STRIPE_ERROR',
  WEBHOOK_ERROR: 'WEBHOOK_ERROR',
  PAYMENT_ERROR: 'PAYMENT_ERROR',

  // Batch Processing Errors
  BATCH_PARTIAL_FAILURE: 'BATCH_PARTIAL_FAILURE',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// ============================================================================
// Error Response Interface
// ============================================================================

/**
 * Standardized error response shape returned by all API endpoints.
 */
export interface ErrorResponse {
  /** Human-readable error message */
  error: string;
  /** Machine-readable error code from ErrorCodes */
  code: string;
  /** Additional error details (validation issues, etc.) - hidden in production */
  details?: unknown;
  /** Request ID for distributed tracing */
  requestId?: string;
}

// ============================================================================
// Base Application Error Class
// ============================================================================

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly requestId: string | undefined;
  public readonly statusCode: number;

  constructor(
  message: string,
  code: ErrorCode = ErrorCodes.INTERNAL_ERROR,
  statusCode: number = 500,
  details?: unknown,
  requestId: string | undefined = undefined,
  options?: { cause?: Error }
  ) {
  super(message, options?.cause ? { cause: options.cause } : undefined);
  this.name = this.constructor.name;
  this.code = code;
  this.statusCode = statusCode;
  this.details = details;
  this.requestId = requestId;

  // Maintains proper stack trace for where our error was thrown
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor);
  }
  }

  toJSON(): ErrorResponse {
  return {
    error: this.message,
    code: this.code,
    ...(this.details !== undefined && { details: this.details }),
    ...(this.requestId !== undefined && { requestId: this.requestId }),
  };
  }

  /**
  * Get sanitized version for client exposure.
  * requestId is always included (needed for support/tracing).
  * details are only included in development.
  */
  toClientJSON(): ErrorResponse {
  const isDevelopment = process.env['NODE_ENV'] === 'development';

  return {
    error: this.message,
    code: this.code,
    ...(isDevelopment && this.details !== undefined && { details: this.details }),
    ...(this.requestId !== undefined && { requestId: this.requestId }),
  };
  }
}

// ============================================================================
// Specific Error Classes
// ============================================================================

export class ValidationError extends AppError {
  constructor(
  message: string = 'Validation failed',
  details?: unknown,
  requestId?: string
  ) {
  super(
    message,
    ErrorCodes.VALIDATION_ERROR,
    400,
    details,
    requestId
  );
  }

  /**
  * Create ValidationError from Zod error issues
  */
  // M4-FIX: Forward requestId so distributed tracing is preserved in validation errors.
  static fromZodIssues(issues: Array<{ path: (string | number)[]; message: string; code: string }>, requestId?: string): ValidationError {
  return new ValidationError(
    'Validation failed',
    issues.map(issue => ({
    path: issue.path,
    message: issue.message,
    code: issue.code,
    })),
    requestId,
  );
  }
}

export class AuthError extends AppError {
  constructor(
  message: string = 'Authentication failed',
  code: ErrorCode = ErrorCodes.AUTH_ERROR,
  details?: unknown
  ) {
  super(message, code, 401, details);
  }

  static tokenInvalid(): AuthError {
  return new AuthError('Invalid or expired token', ErrorCodes.INVALID_TOKEN);
  }

  static tokenExpired(): AuthError {
  return new AuthError('Token has expired', ErrorCodes.TOKEN_EXPIRED);
  }

  static required(): AuthError {
  return new AuthError('Authentication required', ErrorCodes.AUTH_REQUIRED);
  }
}

export class ForbiddenError extends AppError {
  constructor(
  message: string = 'Access denied',
  details?: unknown
  ) {
  super(message, ErrorCodes.FORBIDDEN, 403, details);
  }
}

export class NotFoundError extends AppError {
  constructor(
  resource: string = 'Resource',
  code: ErrorCode = ErrorCodes.NOT_FOUND
  ) {
  super(`${resource} not found`, code, 404);
  }

  static content(): NotFoundError {
  return new NotFoundError('Content', ErrorCodes.CONTENT_NOT_FOUND);
  }

  static domain(): NotFoundError {
  return new NotFoundError('Domain', ErrorCodes.DOMAIN_NOT_FOUND);
  }

  static user(): NotFoundError {
  return new NotFoundError('User', ErrorCodes.USER_NOT_FOUND);
  }

  static intent(): NotFoundError {
  return new NotFoundError('Intent', ErrorCodes.INTENT_NOT_FOUND);
  }
}

export class DatabaseError extends AppError {
  constructor(
  message: string = 'Database error',
  details?: unknown,
  code: ErrorCode = ErrorCodes.DATABASE_ERROR
  ) {
  super(message, code, 500, details);
  }

  /**
  * Create sanitized database error that doesn't leak internal details
  * P2-MEDIUM FIX: Map DB errors to generic messages
  */
  static fromDBError(error: Error): DatabaseError {
  const message = error.message.toLowerCase();
  let sanitizedMessage = 'An unexpected database error occurred';
  let code: ErrorCode = ErrorCodes.DATABASE_ERROR;

  if (message.includes('connection') || message.includes('econnrefused') || message.includes('enotfound')) {
    sanitizedMessage = 'Database connection error. Please try again later.';
    code = ErrorCodes.CONNECTION_ERROR;
  } else if (message.includes('timeout')) {
    sanitizedMessage = 'Database query timeout. Please try a more specific query.';
    code = ErrorCodes.QUERY_TIMEOUT;
  } else if (message.includes('unique constraint') || message.includes('duplicate key')) {
    sanitizedMessage = 'A record with this information already exists.';
    code = ErrorCodes.DUPLICATE_ENTRY;
  }

  return new DatabaseError(sanitizedMessage, { originalError: process.env['NODE_ENV'] === 'development' ? error.message : undefined }, code);
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfter: number;

  constructor(
  message: string = 'Too many requests',
  retryAfter: number = 60
  ) {
  super(message, ErrorCodes.RATE_LIMIT_EXCEEDED, 429);
  this.retryAfter = retryAfter;
  }

  override toJSON(): ErrorResponse & { retryAfter: number } {
  return {
    ...super.toJSON(),
    retryAfter: this.retryAfter,
  };
  }
}

export class ConflictError extends AppError {
  constructor(
  message: string = 'Resource conflict',
  details?: unknown
  ) {
  super(message, ErrorCodes.CONFLICT, 409, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(
  message: string = 'Service temporarily unavailable'
  ) {
  super(message, ErrorCodes.SERVICE_UNAVAILABLE, 503);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(
  message: string = 'Request payload too large',
  details?: unknown
  ) {
  super(message, ErrorCodes.PAYLOAD_TOO_LARGE, 413, details);
  }
}

export class BatchError extends AppError {
  public readonly errors: ReadonlyArray<{ index: number; error: Error }>;

  constructor(
  message: string = 'Batch operation partially failed',
  errors: Array<{ index: number; error: Error }> = [],
  details?: unknown,
  ) {
  super(message, ErrorCodes.BATCH_PARTIAL_FAILURE, 500, details);
  this.errors = errors;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
* Sanitize error for client response
* Prevents leaking internal error details
* P2-MEDIUM FIX: Complete error sanitization with NODE_ENV check
*/
export function sanitizeErrorForClient(error: unknown): ErrorResponse {
  // Log full error server-side for debugging
  logger.error('Internal error', error instanceof Error ? error : new Error(String(error)));

  // If it's already an AppError, use its serialization
  if (error instanceof AppError) {
  return error.toClientJSON();
  }

  // Handle specific known error types
  if (error instanceof Error) {
  // Zod validation errors - check using property validation instead of unsafe cast
  if (error.name === 'ZodError' || (error && typeof error === 'object' && 'issues' in error && Array.isArray((error as { issues?: unknown }).issues))) {
    const issues = ((error as { issues?: ZodIssue[] }).issues) || [];
    return {
    error: 'Validation failed',
    code: ErrorCodes.VALIDATION_ERROR,
    details: issues.map((issue: ZodIssue) => ({
    path: issue.path,
    message: issue.message,
    code: issue.code,
    })),
    };
  }

  // Check for specific error codes using property access
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined;
  if (code && Object.values(ErrorCodes).includes(code as ErrorCode)) {
    return {
    error: error.message,
    code: code as ErrorCode,
    };
  }

  // P2-MEDIUM FIX: Sanitize database errors
  const errorMessage = error.message.toLowerCase();
  if (errorMessage.includes('database') ||
    errorMessage.includes('connection') ||
    errorMessage.includes('query') ||
    errorMessage.includes('sql') ||
    errorMessage.includes('postgres')) {
    return {
    error: 'Database error occurred. Please try again later.',
    code: ErrorCodes.DATABASE_ERROR,
    };
  }
  }

  // Default: generic error message (prevents info leakage)
  return {
  error: 'An error occurred processing your request',
  code: ErrorCodes.INTERNAL_ERROR,
  };
}

/**
* Create a standardized error response object
* P2-MEDIUM FIX: Only include details in development
*/
export function createErrorResponse(
  message: string,
  code: ErrorCode = ErrorCodes.INTERNAL_ERROR,
  details?: unknown,
  requestId?: string
): ErrorResponse {
  const isDevelopment = process.env['NODE_ENV'] === 'development';

  const response: ErrorResponse = {
    error: message,
    code,
  };

  if (details !== undefined && isDevelopment) {
  response.details = details;
  }

  if (requestId !== undefined) {
  response.requestId = requestId;
  }

  return response;
}

/**
* Zod issue interface
*/
export interface ZodIssue {
  path: (string | number)[];
  message: string;
  code: string;
}

/**
* Error with issues interface
*/
export interface ErrorWithIssues {
  issues?: ZodIssue[];
  errors?: ZodIssue[];
}

/**
* Extract Zod issues from validation error safely
* Always uses .issues instead of deprecated ["errors"]
*/
export function extractZodIssues(error: unknown): Array<{ path: (string | number)[]; message: string; code: string }> {
  if (!error || typeof error !== 'object') {
  return [];
  }

  const err = error as ErrorWithIssues;

  // Always prefer .issues over deprecated ["errors"]
  if (Array.isArray(err.issues)) {
  return err.issues.map((issue: ZodIssue) => ({
    path: issue.path || [],
    message: issue.message || 'Invalid value',
    code: issue.code || 'invalid_type',
  }));
  }

  // Fallback for legacy error formats
  if (Array.isArray(err.errors)) {
  return err.errors.map((errorItem: ZodIssue) => ({
    path: errorItem.path || [],
    message: errorItem.message || 'Invalid value',
    code: errorItem.code || 'invalid_type',
  }));
  }

  return [];
}

/**
* Get HTTP status code for error code
*/
export function getStatusCodeForErrorCode(code: ErrorCode): number {
  switch (code) {
  case ErrorCodes.VALIDATION_ERROR:
  case ErrorCodes.INVALID_PARAMS:
  case ErrorCodes.INVALID_INPUT:
  case ErrorCodes.INVALID_UUID:
  case ErrorCodes.INVALID_FORMAT:
  case ErrorCodes.INVALID_EMAIL:
  case ErrorCodes.INVALID_URL:
  case ErrorCodes.INVALID_DATE:
  case ErrorCodes.INVALID_RANGE:
  case ErrorCodes.INVALID_LENGTH:
  case ErrorCodes.REQUIRED_FIELD:
  case ErrorCodes.MISSING_PARAMETER:
    return 400;
  case ErrorCodes.AUTH_ERROR:
  case ErrorCodes.AUTH_REQUIRED:
  case ErrorCodes.UNAUTHORIZED:
  case ErrorCodes.INVALID_TOKEN:
  case ErrorCodes.TOKEN_EXPIRED:
    return 401;
  case ErrorCodes.FORBIDDEN:
  case ErrorCodes.INSUFFICIENT_PERMISSIONS:
  case ErrorCodes.DOMAIN_NOT_OWNED:
  case ErrorCodes.ACCESS_DENIED:
    return 403;
  case ErrorCodes.NOT_FOUND:
  case ErrorCodes.CONTENT_NOT_FOUND:
  case ErrorCodes.DOMAIN_NOT_FOUND:
  case ErrorCodes.INTENT_NOT_FOUND:
  case ErrorCodes.USER_NOT_FOUND:
    return 404;
  case ErrorCodes.METHOD_NOT_ALLOWED:
    return 405;
  case ErrorCodes.DUPLICATE_ENTRY:
  case ErrorCodes.DUPLICATE_KEY:
  case ErrorCodes.CONFLICT:
  case ErrorCodes.RESOURCE_CONFLICT:
    return 409;
  case ErrorCodes.PAYLOAD_TOO_LARGE:
  case ErrorCodes.JSONB_SIZE_EXCEEDED:
    return 413;
  case ErrorCodes.UNSUPPORTED_MEDIA_TYPE:
    return 415;
  case ErrorCodes.QUOTA_EXCEEDED:
    return 402; // M6-FIX: QUOTA_EXCEEDED → 402 Payment Required
  case ErrorCodes.RATE_LIMIT_EXCEEDED:
    return 429;
  case ErrorCodes.SERVICE_UNAVAILABLE:
  case ErrorCodes.CIRCUIT_OPEN:
    return 503;
  case ErrorCodes.TIMEOUT_ERROR:
    return 504;
  case ErrorCodes.INTERNAL_ERROR:
  case ErrorCodes.DATABASE_ERROR:
  case ErrorCodes.CONNECTION_ERROR:
  case ErrorCodes.QUERY_TIMEOUT:
  case ErrorCodes.PUBLISH_FAILED:
  case ErrorCodes.INTENT_RETRIEVAL_FAILED:
  case ErrorCodes.BILLING_ERROR:
  case ErrorCodes.EXTERNAL_API_ERROR:
  case ErrorCodes.STRIPE_ERROR:
  case ErrorCodes.WEBHOOK_ERROR:
  case ErrorCodes.PAYMENT_ERROR:
  default:
    return 500;
  }
}

/**
* Format Zod validation error for consistent response
* Always uses .issues instead of deprecated ["errors"]
*/
export function formatZodError(error: unknown): { message: string; issues: Array<{ path: (string | number)[]; message: string; code: string }> } {
  const issues = extractZodIssues(error);

  return {
    message: issues.length > 0
      ? `Validation failed: ${issues.map(i => i.message).join(', ')}`
      : 'Validation failed',
    issues,
  };
}

/**
* Check if we should expose detailed error info
* P2-MEDIUM FIX: Centralized NODE_ENV check
*/
export function shouldExposeErrorDetails(): boolean {
  // M3-FIX: Removed DEBUG=true bypass. Detailed errors must never leak in
  // production regardless of debug flags — gate solely on NODE_ENV.
  return process.env['NODE_ENV'] === 'development';
}

/**
* Safely stringify error for logging (prevents circular reference issues)
*/
export function safeStringifyError(error: unknown): string {
  if (error instanceof Error) {
    const result: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    if (error.cause) {
      result['cause'] = safeStringifyError(error.cause);
    }
    return JSON.stringify(result);
  }

  try {
  return JSON.stringify(error);
  } catch {
  return String(error);
  }
}

/**
 * Extract error message from unknown catch parameter.
 * Standardized pattern for catch blocks across the codebase.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ============================================================================
// Export all error codes as individual constants for convenience
// ============================================================================

export const {
  VALIDATION_ERROR,
  INVALID_PARAMS,
  INVALID_INPUT,
  INVALID_UUID,
  INVALID_FORMAT,
  INVALID_EMAIL,
  INVALID_URL,
  INVALID_DATE,
  INVALID_RANGE,
  INVALID_LENGTH,
  REQUIRED_FIELD,
  UNSUPPORTED_MEDIA_TYPE,
  MISSING_PARAMETER,
  AUTH_ERROR,
  AUTH_REQUIRED,
  UNAUTHORIZED,
  INVALID_TOKEN,
  TOKEN_EXPIRED,
  INSUFFICIENT_PERMISSIONS,
  FORBIDDEN,
  NOT_FOUND,
  CONTENT_NOT_FOUND,
  DOMAIN_NOT_FOUND,
  INTENT_NOT_FOUND,
  USER_NOT_FOUND,
  DOMAIN_NOT_OWNED,
  ACCESS_DENIED,
  DATABASE_ERROR,
  DUPLICATE_ENTRY,
  DUPLICATE_KEY,
  CONNECTION_ERROR,
  QUERY_TIMEOUT,
  INTERNAL_ERROR,
  SERVICE_UNAVAILABLE,
  RATE_LIMIT_EXCEEDED,
  TIMEOUT_ERROR,
  CIRCUIT_OPEN,
  PUBLISH_FAILED,
  INTENT_RETRIEVAL_FAILED,
  BILLING_ERROR,
  QUOTA_EXCEEDED,
  METHOD_NOT_ALLOWED,
  PAYLOAD_TOO_LARGE,
  JSONB_SIZE_EXCEEDED,
  CONFLICT,
  RESOURCE_CONFLICT,
  EXTERNAL_API_ERROR,
  STRIPE_ERROR,
  WEBHOOK_ERROR,
  PAYMENT_ERROR,
  BATCH_PARTIAL_FAILURE,
} = ErrorCodes;

export { withContext, type OperationContext } from './error-context';
export { createRouteErrorHandler } from './route-error-handler';
