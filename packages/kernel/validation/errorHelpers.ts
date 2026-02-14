/**
 * Error Helper Utilities
 * 
 * Provides utilities for formatting, normalizing, and working with errors
 * in a consistent manner across the application.
 */

import { ValidationError, ErrorCode, ErrorCodes } from './types-base';

// ============================================================================
// Types
// ============================================================================

export interface FormattedValidationError {
  field: string;
  message: string;
  code: ErrorCode;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a ValidationError
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError || 
    (typeof error === 'object' && 
     error !== null && 
     'name' in error && 
     error.name === 'ValidationError');
}

// ============================================================================
// Error Formatting
// ============================================================================

/**
 * Format validation errors from various sources into a consistent structure
 */
export function formatValidationErrors(
  errors: Array<{ field?: string; message: string; code?: string }>
): FormattedValidationError[] {
  return errors.map(err => ({
    field: err.field || 'unknown',
    message: err.message,
    code: (err.code as ErrorCode) || ErrorCodes.VALIDATION_ERROR,
  }));
}

/**
 * Create a validation error from a single field error
 */
export function createValidationError(
  field: string,
  message: string,
  code: ErrorCode = ErrorCodes.VALIDATION_ERROR
): ValidationError {
  return new ValidationError(message, field, code);
}

/**
 * Normalize any error into a ValidationError
 */
export function normalizeError(error: unknown): ValidationError {
  if (error instanceof ValidationError) {
    return error;
  }

  if (error instanceof Error) {
    return new ValidationError(error.message, undefined, ErrorCodes.VALIDATION_ERROR);
  }

  if (typeof error === 'string') {
    return new ValidationError(error, undefined, ErrorCodes.VALIDATION_ERROR);
  }

  return new ValidationError(
    'An unknown error occurred',
    undefined,
    ErrorCodes.INTERNAL_ERROR
  );
}

// ============================================================================
// Error Aggregation
// ============================================================================

/**
 * Aggregate multiple validation errors into a single error
 */
export class AggregateValidationError extends ValidationError {
  public readonly errors: FormattedValidationError[];

  constructor(errors: FormattedValidationError[]) {
    const message = errors.length === 1 
      ? errors[0]!.message 
      : `${errors.length} validation errors occurred`;
    
    super(message, undefined, ErrorCodes.VALIDATION_ERROR);
    this.name = 'AggregateValidationError';
    this.errors = errors;
  }

  override toJSON(): { message: string; code: ErrorCode; errors: FormattedValidationError[] } {
    return {
      message: this.message,
      // P2-TYPE FIX: Access inherited `code` property directly instead of unsafe double cast
      code: this.code as ErrorCode,
      errors: this.errors,
    };
  }
}

/**
 * Builder for collecting multiple validation errors
 */
export class ValidationErrorBuilder {
  private errors: FormattedValidationError[] = [];

  /**
   * Add a validation error
   */
  add(field: string, message: string, code: ErrorCode = ErrorCodes.VALIDATION_ERROR): this {
    this.errors.push({ field, message, code });
    return this;
  }

  /**
   * Add an error if condition is true
   */
  addIf(condition: boolean, field: string, message: string, code?: ErrorCode): this {
    if (condition) {
      this.add(field, message, code);
    }
    return this;
  }

  /**
   * Add error from an existing ValidationError
   */
  addError(error: ValidationError): this {
    this.errors.push({
      field: error.field || 'unknown',
      message: error.message,
      code: error.code as ErrorCode,
    });
    return this;
  }

  /**
   * Check if any errors have been added
   */
  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /**
   * Get the number of errors
   */
  getErrorCount(): number {
    return this.errors.length;
  }

  /**
   * Get all errors
   */
  getErrors(): ReadonlyArray<FormattedValidationError> {
    return this.errors;
  }

  /**
   * Throw if there are any errors
   */
  throwIfHasErrors(): void {
    if (this.hasErrors()) {
      throw new AggregateValidationError(this.errors);
    }
  }

  /**
   * Build and return an AggregateValidationError if there are errors
   */
  build(): AggregateValidationError | null {
    if (this.hasErrors()) {
      return new AggregateValidationError(this.errors);
    }
    return null;
  }

  /**
   * Clear all errors
   */
  clear(): this {
    this.errors = [];
    return this;
  }
}

// ============================================================================
// Error Recovery
// ============================================================================

/**
 * Error recovery strategies
 */
export type RecoveryStrategy = 
  | 'retry'           // Retry the operation
  | 'fallback'        // Use fallback value
  | 'ignore'          // Ignore the error
  | 'fail'            // Fail immediately
  | 'degrade';        // Degrade functionality gracefully

/**
 * Error recovery configuration
 */
export interface ErrorRecoveryConfig<T> {
  strategy: RecoveryStrategy;
  fallback?: T;
  maxRetries?: number;
  retryDelayMs?: number;
  onRecovery?: (error: Error, strategy: RecoveryStrategy) => void;
}

/**
 * Attempt to recover from an error based on configuration
 */
export async function attemptRecovery<T>(
  error: Error,
  config: ErrorRecoveryConfig<T>
): Promise<T | undefined> {
  switch (config.strategy) {
    case 'fallback':
      config.onRecovery?.(error, 'fallback');
      return config.fallback;
    
    case 'ignore':
      config.onRecovery?.(error, 'ignore');
      return undefined;
    
    case 'fail':
      throw error;
    
    case 'degrade':
      config.onRecovery?.(error, 'degrade');
      return config.fallback;
    
    case 'retry':
      // Retry logic is handled at a higher level
      config.onRecovery?.(error, 'retry');
      throw error;
    
    default: {
      // Exhaustiveness check
      const _exhaustiveCheck: never = config.strategy;
      throw error;
    }
  }
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Classify error type for appropriate handling
 */
export type ErrorClass =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'service_unavailable'
  | 'internal'
  | 'network'
  | 'unknown';

/**
 * Classify an error based on its code or message
 */
export function classifyError(error: unknown): ErrorClass {
  if (error instanceof ValidationError) {
    switch (error.code) {
      case ErrorCodes.VALIDATION_ERROR:
      case ErrorCodes.INVALID_PARAMS:
      case ErrorCodes.INVALID_INPUT:
      case ErrorCodes.INVALID_UUID:
      case ErrorCodes.INVALID_FORMAT:
      case ErrorCodes.PAYLOAD_TOO_LARGE:
      case ErrorCodes.JSONB_SIZE_EXCEEDED:
        return 'validation';
      
      case ErrorCodes.AUTH_ERROR:
      case ErrorCodes.AUTH_REQUIRED:
      case ErrorCodes.INVALID_TOKEN:
      case ErrorCodes.TOKEN_EXPIRED:
        return 'authentication';
      
      case ErrorCodes.FORBIDDEN:
      case ErrorCodes.INSUFFICIENT_PERMISSIONS:
      case ErrorCodes.DOMAIN_NOT_OWNED:
      case ErrorCodes.ACCESS_DENIED:
        return 'authorization';
      
      case ErrorCodes.NOT_FOUND:
      case ErrorCodes.CONTENT_NOT_FOUND:
      case ErrorCodes.DOMAIN_NOT_FOUND:
      case ErrorCodes.USER_NOT_FOUND:
      case ErrorCodes.INTENT_NOT_FOUND:
        return 'not_found';
      
      case ErrorCodes.DUPLICATE_ENTRY:
      case ErrorCodes.CONFLICT:
      case ErrorCodes.RESOURCE_CONFLICT:
        return 'conflict';
      
      case ErrorCodes.RATE_LIMIT_EXCEEDED:
        return 'rate_limit';
      
      case ErrorCodes.SERVICE_UNAVAILABLE:
        return 'service_unavailable';
      
      case ErrorCodes.CONNECTION_ERROR:
      case ErrorCodes.QUERY_TIMEOUT:
        return 'network';
      
      case ErrorCodes.INTERNAL_ERROR:
      case ErrorCodes.DATABASE_ERROR:
      case ErrorCodes.PUBLISH_FAILED:
      case ErrorCodes.BILLING_ERROR:
      default:
        return 'internal';
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('network') || message.includes('connection') || message.includes('timeout')) {
      return 'network';
    }
    
    if (message.includes('not found') || message.includes('404')) {
      return 'not_found';
    }
    
    if (message.includes('unauthorized') || message.includes('401')) {
      return 'authentication';
    }
    
    if (message.includes('forbidden') || message.includes('403')) {
      return 'authorization';
    }
    
    if (message.includes('conflict') || message.includes('409')) {
      return 'conflict';
    }
    
    if (message.includes('rate limit') || message.includes('429')) {
      return 'rate_limit';
    }
    
    if (message.includes('service unavailable') || message.includes('503')) {
      return 'service_unavailable';
    }
  }

  return 'unknown';
}

/**
 * Get HTTP status code for error classification
 */
export function getHttpStatusForErrorClass(errorClass: ErrorClass): number {
  switch (errorClass) {
    case 'validation': return 400;
    case 'authentication': return 401;
    case 'authorization': return 403;
    case 'not_found': return 404;
    case 'conflict': return 409;
    case 'rate_limit': return 429;
    case 'service_unavailable': return 503;
    case 'internal':
    case 'network':
    case 'unknown':
    default:
      return 500;
  }
}
