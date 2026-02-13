import { AppError, ErrorCodes, type ErrorCode } from './index';

/**
 * Contextual information about what operation was being performed when an error occurred.
 */
export interface OperationContext {
  /** What operation was being performed, e.g., 'createOrganization', 'searchDocuments' */
  operation: string;
  /** What type of resource was involved, e.g., 'domain', 'subscription' */
  resource?: string;
  /** Specific resource identifier, e.g., a UUID */
  resourceId?: string;
  /** Additional key-value pairs for debugging */
  metadata?: Record<string, unknown>;
}

/**
 * Wrap any error with operational context, preserving the full cause chain.
 *
 * Instead of:
 *   throw new Error('Search operation failed');  // original error lost!
 *
 * Use:
 *   throw withContext(error, { operation: 'search', resource: 'documents' });
 */
export function withContext(
  error: unknown,
  context: OperationContext
): AppError {
  const cause = error instanceof Error ? error : new Error(String(error));

  const code: ErrorCode = (error instanceof AppError)
    ? error.code
    : ErrorCodes.INTERNAL_ERROR;
  const statusCode = (error instanceof AppError) ? error.statusCode : 500;

  const message = `${context.operation} failed: ${cause.message}`;

  return new AppError(
    message,
    code,
    statusCode,
    context,
    (error instanceof AppError) ? error.requestId : undefined,
    { cause }
  );
}
