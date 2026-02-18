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
        // P1-7 FIX: Only forward error.details in non-production environments.
        // In production, error.details may contain internal state (DB schema,
        // service topology, stack traces) that must not reach API consumers.
        const safeDetails = process.env['NODE_ENV'] !== 'production' ? error.details : undefined;
        return sendError(res, getStatusCodeForError(error.code as ErrorCode), error.code as ErrorCode, error.message, {
        details: safeDetails,
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
* Classify error type based on the error's structural identity (name / code),
* not its message text.
*
* P1-5 FIX: The previous implementation fell back to message.includes() for
* 'timeout', 'connection', 'unauthorized', and 'forbidden'. This is fragile:
*   - Library error messages change across versions → silent misclassification.
*   - A DB error whose message mentions 'unauthorized_access_log' table would
*     be returned to the client as HTTP 401, blocking legitimate admin access.
* We now rely exclusively on error.name, which is the idiomatic structural
* identifier for Error subclasses. Unknown errors fall to INTERNAL_ERROR,
* which is the safe default — the catch block logs the real cause.
*
* @param error - Error to classify
* @returns Error code
*/
function classifyError(error: Error): ErrorCode {
  switch (error.name) {
    case 'UnauthorizedError': return ErrorCodes.AUTH_REQUIRED;
    case 'ForbiddenError':    return ErrorCodes.FORBIDDEN;
    case 'ValidationError':   return ErrorCodes.VALIDATION_ERROR;
    case 'QueryTimeoutError': return ErrorCodes.QUERY_TIMEOUT;
    case 'ConnectionError':   return ErrorCodes.CONNECTION_ERROR;
    default:                  return ErrorCodes.INTERNAL_ERROR;
  }
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
// P2-6 FIX: Added .strict() — without it, extra query parameters (including
// prototype-pollution attempts like ?__proto__=x) were silently accepted and
// stripped. .strict() rejects requests with unknown keys, making typos in
// param names (e.g. ?statuss=failed) visible to the caller rather than silent.
const DLQListQuerySchema = PaginationQuerySchema.extend({
  region: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
  status: z.enum(['pending', 'processing', 'failed', 'resolved']).optional(),
}).strict();


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
    // P1-3 FIX: Rate limit before auth — prevents unauthenticated callers from
    // spamming auth failures without consuming any rate-limit quota.
    await rateLimit(`admin:dlq:${req.ip}`, 40);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin']);

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
        { details: queryValidation['error']['issues'] }
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
    await rateLimit(`admin:dlq:retry:${req.ip}`, 20);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin']);

    // Validate orgId is present
    if (!ctx["orgId"]) {
    throw new ExternalAPIError(
        'Organization ID is required',
        ErrorCodes.INVALID_INPUT,
        { field: 'orgId' }
    );
    }

    // P2-13 FIX: Use a typed accessor instead of `as` cast on req.params.
    // Fastify types req.params as unknown without a schema declaration; the
    // cast previously hid the fact that `id` could be undefined at runtime.
    const params = req.params as Record<string, string | undefined>;
    const id = params['id'];
    if (!id) {
      throw new ExternalAPIError('Missing route parameter: id', ErrorCodes.VALIDATION_ERROR, { field: 'id' });
    }
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
    await rateLimit(`admin:dlq:delete:${req.ip}`, 20);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin']);

    // Validate orgId is present
    if (!ctx["orgId"]) {
    throw new ExternalAPIError(
        'Organization ID is required',
        ErrorCodes.INVALID_INPUT,
        { field: 'orgId' }
    );
    }

    // P2-13 FIX: Safe accessor instead of `as` cast.
    const deleteParams = req.params as Record<string, string | undefined>;
    const id = deleteParams['id'];
    if (!id) {
      throw new ExternalAPIError('Missing route parameter: id', ErrorCodes.VALIDATION_ERROR, { field: 'id' });
    }
    validateUUID(id, 'id');

    // SECURITY FIX P0-4: Use proper delete instead of retry to prevent accidental re-execution
    // SECURITY FIX P0-3: Pass orgId for tenant isolation
    await dlq.delete(ctx["orgId"], id);

    return res.status(204).send();
  }));
}
