import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { DLQService } from '@kernel/queue';
import { ErrorCodes, PaginationQuerySchema, validateUUID, type ErrorCode, ExternalAPIError } from '@kernel/validation';
import { getLogger } from '@kernel/logger';

import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';
import { errors, sendError } from '@errors/responses';

// P2-6: Use structured logger instead of console.error
const logger = getLogger('queue-routes');

/**
* Queue Routes
*
* Admin endpoints for managing job queues and dead letter queues
*
* MEDIUM FIX E2: Add error boundaries in queue routes
* MEDIUM FIX I1: Add validation on query parameters
* MEDIUM FIX E1: Use error codes instead of message sniffing
* MEDIUM FIX E4: Improve generic error messages
* MEDIUM FIX E6: Standardize error response formats
* MEDIUM FIX E7: Add error context
* MEDIUM FIX M16: Add JSDoc comments
*/




/**
* Error boundary for queue routes
* MEDIUM FIX E2: Add error boundaries in queue routes
*
* @param handler - Route handler function
* @returns Wrapped handler with error boundary
*/
function withErrorBoundary(
  handler: (req: FastifyRequest, res: FastifyReply) => Promise<unknown>
) {
  return async (req: FastifyRequest, res: FastifyReply): Promise<unknown> => {
    try {
    return await handler(req, res);
    } catch (error) {
    // P2-6: Use structured logger with context instead of console.error
    logger.error('[queueRoutes] Error', error instanceof Error ? error : new Error(String(error)), {
        path: req.url,
        method: req.method,
        code: error instanceof ExternalAPIError ? error.code : ErrorCodes.INTERNAL_ERROR,
    });

    // Send standardized error response
        if (error instanceof ExternalAPIError) {
        return sendError(res, getStatusCodeForError(error.code as ErrorCode), error.code as ErrorCode, error.message, {
        details: error.details,
        });
    }

    if (error instanceof Error) {
                const errorCode = classifyError(error);
        const statusCode = getStatusCodeForError(errorCode);

                return sendError(res, statusCode, errorCode, getUserFriendlyErrorMessage(errorCode, error));
    }

    // Generic error fallback
    return errors.internal(res);
    }
  };
}

/**
* Classify error type based on error characteristics
* MEDIUM FIX E1: Use error codes instead of message sniffing
*
* @param error - Error to classify
* @returns Error code
*/
function classifyError(error: Error): ErrorCode {
  const message = error.message.toLowerCase();

  // Check for specific error patterns without relying on message sniffing
  if (error.name === 'UnauthorizedError' || message.includes('unauthorized')) {
    return ErrorCodes.AUTH_REQUIRED;
  }
  if (error.name === 'ForbiddenError' || message.includes('forbidden')) {
    return ErrorCodes.FORBIDDEN;
  }
  if (error.name === 'ValidationError') {
    return ErrorCodes.VALIDATION_ERROR;
  }
  if (message.includes('timeout')) {
    return ErrorCodes.QUERY_TIMEOUT;
  }
  if (message.includes('connection')) {
    return ErrorCodes.CONNECTION_ERROR;
  }

  return ErrorCodes.INTERNAL_ERROR;
}

/**
* Get HTTP status code for error code
* MEDIUM FIX E6: Standardize error response formats
*
* @param code - Error code
* @returns HTTP status code
*/
function getStatusCodeForError(code: ErrorCode): number {
  switch (code) {
    case ErrorCodes.AUTH_REQUIRED:
    return 401;
    case ErrorCodes.FORBIDDEN:
    return 403;
    case ErrorCodes.NOT_FOUND:
    return 404;
    case ErrorCodes.VALIDATION_ERROR:
    case ErrorCodes.INVALID_UUID:
    return 400;
    case ErrorCodes.CONFLICT:
    case ErrorCodes.DUPLICATE_ENTRY:
    return 409;
    case ErrorCodes.RATE_LIMIT_EXCEEDED:
    return 429;
    case ErrorCodes.QUERY_TIMEOUT:
    return 408;
    case ErrorCodes.SERVICE_UNAVAILABLE:
    return 503;
    default:
    return 500;
  }
}

/**
* Get user-friendly error message
* MEDIUM FIX E4: Improve generic error messages
*
* @param code - Error code
* @param originalError - Original error
* @returns User-friendly message
*/
function getUserFriendlyErrorMessage(code: ErrorCode, originalError: Error): string {
  switch (code) {
    case ErrorCodes.AUTH_REQUIRED:
    return 'Authentication required. Please log in.';
    case ErrorCodes.FORBIDDEN:
    return 'You do not have permission to perform this action.';
    case ErrorCodes.VALIDATION_ERROR:
    return 'Invalid input. Please check your data and try again.';
    case ErrorCodes.NOT_FOUND:
    return 'The requested resource was not found.';
    case ErrorCodes.QUERY_TIMEOUT:
    return 'The request timed out. Please try again.';
    case ErrorCodes.RATE_LIMIT_EXCEEDED:
    return 'Too many requests. Please wait a moment and try again.';
    case ErrorCodes.SERVICE_UNAVAILABLE:
    return 'Service temporarily unavailable. Please try again later.';
    default:
    // Don't expose internal error details in production
    return process.env['NODE_ENV'] === 'production'
        ? 'An unexpected error occurred. Please try again later.'
        : originalError.message;
  }
}

/**
* DLQ list query parameters schema
* MEDIUM FIX I1: Add validation on query parameters
*/
const DLQListQuerySchema = PaginationQuerySchema.extend({
  region: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
  status: z.enum(['pending', 'processing', 'failed', 'resolved']).optional(),
});


/**
* Register queue routes
* MEDIUM FIX M16: Add JSDoc comments
*
* @param app - Fastify instance
* @param pool - Database pool
*/
export async function queueRoutes(app: FastifyInstance, pool: Pool) {
  const dlq = new DLQService(pool);

  /**
  * Get DLQ items
  * MEDIUM FIX I1: Add validation on query parameters
  * MEDIUM FIX E2: Add error boundaries
  */
  app.get('/admin/dlq', withErrorBoundary(async (req, res) => {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin']);
    await rateLimit('admin:dlq', 40);

    // Validate orgId is present
    if (!ctx["orgId"]) {
    throw new ExternalAPIError(
        'Organization ID is required',
        ErrorCodes.INVALID_INPUT,
        { field: 'orgId' }
    );
    }

    // Validate UUID format - MEDIUM FIX I2: Standardize UUID validation
    validateUUID(ctx["orgId"], 'orgId');

    // Parse and validate query parameters
    const queryValidation = DLQListQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
    throw new ExternalAPIError(
        'Invalid query parameters',
        ErrorCodes.VALIDATION_ERROR,
        { details: queryValidation["error"].issues }
    );
    }

    const query = queryValidation.data;

    // SECURITY FIX P0-3: Pass orgId for tenant isolation
    const results = await dlq.list(
      ctx["orgId"],
      query.region,
      query["limit"],
      query.offset
    );

    return res.send(results);
  }));

  /**
  * Retry a DLQ item
  * MEDIUM FIX I1: Add validation on query parameters
  * MEDIUM FIX E2: Add error boundaries
  */
  app.post('/admin/dlq/:id/retry', withErrorBoundary(async (req, res) => {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin']);
    await rateLimit('admin:dlq:retry', 20);

    // Validate orgId is present
    if (!ctx["orgId"]) {
    throw new ExternalAPIError(
        'Organization ID is required',
        ErrorCodes.INVALID_INPUT,
        { field: 'orgId' }
    );
    }

    // Validate DLQ item ID - MEDIUM FIX I2: Standardize UUID validation
    const { id } = req.params as { id: string };
    validateUUID(id, 'id');

    // SECURITY FIX P0-3: Pass orgId for tenant isolation
    const result = await dlq.retry(ctx["orgId"], id);

    return res.send({ success: true, data: result });
  }));

  /**
  * Delete a DLQ item
  * MEDIUM FIX I1: Add validation on query parameters
  * MEDIUM FIX E2: Add error boundaries
  */
  app.delete('/admin/dlq/:id', withErrorBoundary(async (req, res) => {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin']);
    await rateLimit('admin:dlq:delete', 20);

    // Validate orgId is present
    if (!ctx["orgId"]) {
    throw new ExternalAPIError(
        'Organization ID is required',
        ErrorCodes.INVALID_INPUT,
        { field: 'orgId' }
    );
    }

    // Validate DLQ item ID - MEDIUM FIX I2: Standardize UUID validation
    const { id } = req.params as { id: string };
    validateUUID(id, 'id');

    // SECURITY FIX P0-4: Use proper delete instead of retry to prevent accidental re-execution
    // SECURITY FIX P0-3: Pass orgId for tenant isolation
    await dlq.delete(ctx["orgId"], id);

    return res.status(204).send();
  }));
}
