/**
 * P2-MEDIUM FIX: Database Error Sanitization
 * 
 * CRITICAL: Transaction Error Handling
 * - Properly chains rollback errors with original errors
 * - Prevents silent rollback failures
 * - Maintains error context for debugging
 */

import { getLogger } from '@kernel/logger';

const logger = getLogger('database:errors');

/**
 * Custom error class for transaction failures
 * Chains original error with rollback error for debugging
 */
export class TransactionError extends Error {
  constructor(
    message: string,
    public readonly originalError: Error,
    public readonly rollbackError?: Error
  ) {
    super(message);
    this.name = 'TransactionError';
    
    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TransactionError);
    }
  }

  /**
   * Get the root cause of the transaction failure
   */
  get rootCause(): Error {
    return this.originalError;
  }

  /**
   * Check if rollback also failed
   */
  get hasRollbackFailure(): boolean {
    return this.rollbackError !== undefined;
  }

  /**
   * Serialize error for logging/monitoring
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      originalError: this.originalError.message,
      rollbackError: this.rollbackError?.message,
      stack: this.stack,
    };
  }
}

/**
 * Map database errors to generic messages for client exposure
 * Prevents leaking internal database details
 * @param error - Original database error
 * @returns Sanitized error message
 */
export function sanitizeDBError(error: Error): string {
  const message = error["message"].toLowerCase();

  // Check for specific database error patterns
  if (message.includes('connection') || message.includes('econnrefused')) {
    return 'Database connection error. Please try again later.';
  }

  if (message.includes('timeout')) {
    return 'Database query timeout. Please try a more specific query.';
  }

  if (message.includes('unique constraint') || message.includes('duplicate key')) {
    return 'A record with this information already exists.';
  }

  if (message.includes('foreign key constraint')) {
    return 'Referenced record does not exist.';
  }

  if (message.includes('check constraint')) {
    return 'Data validation failed. Please check your input.';
  }

  if (message.includes('permission denied') || message.includes('not permitted')) {
    return 'Insufficient permissions for this operation.';
  }

  if (message.includes('syntax error')) {
    return 'Invalid database query.';
  }

  // Default generic message
  return 'An unexpected database error occurred. Please try again later.';
}

/**
 * Check if error is a known database error type
 * @param error - Error to check
 * @returns True if it's a known database error
 */
export function isDBError(error: Error): boolean {
  const message = error["message"].toLowerCase();
  return (
    message.includes('database') ||
    message.includes('connection') ||
    message.includes('query') ||
    message.includes('sql') ||
    message.includes('constraint') ||
    message.includes('postgres') ||
    message.includes('pool')
  );
}

/**
 * Create a sanitized error from a database error
 * @param error - Original error
 * @param context - Optional context for logging
 * @returns Sanitized Error object
 */
export function createSanitizedError(error: Error, context?: Record<string, unknown>): Error {
  // Log the original error for debugging
  logger["error"]('Database error', error, context);
  
  // Return sanitized error
  return new Error(sanitizeDBError(error));
}
