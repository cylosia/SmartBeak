import type { FastifyReply } from 'fastify';
import { getLogger, type Logger } from '@kernel/logger';
import { getRequestId } from '@kernel/request-context';
import {
  AppError,
  ErrorCodes,
  type ErrorCode,
  type ErrorResponse,
  shouldExposeErrorDetails,
  RateLimitError,
} from './index';

interface RouteErrorHandlerOptions {
  /** Logger instance or service name string (will create a logger) */
  logger: Logger | string;
}

interface ErrorLike {
  message: string;
  statusCode?: number;
  code?: string;
}

/**
 * Creates a reusable error handler for Fastify route catch blocks.
 *
 * Standardizes error responses across all routes with:
 * - Correct HTTP status codes derived from error type
 * - Machine-readable error codes from ErrorCodes
 * - Request ID for distributed tracing
 * - Dev-mode diagnostic hints and cause chain details
 * - Structured server-side logging
 *
 * Usage:
 *   const handleError = createRouteErrorHandler({ logger: 'orgs' });
 *   app.post('/orgs', async (req, res) => {
 *     try { ... } catch (error) {
 *       return handleError(res, error, 'create organization');
 *     }
 *   });
 */
export function createRouteErrorHandler(options: RouteErrorHandlerOptions) {
  const log = typeof options.logger === 'string'
    ? getLogger(options.logger)
    : options.logger;

  return function handleRouteError(
    res: FastifyReply,
    error: unknown,
    operationDescription: string,
  ): void {
    const requestId = getRequestId();
    const err = error instanceof Error ? error : new Error(String(error));

    // Always log the full error server-side for debugging
    log.error(`${operationDescription} failed`, err, {
      requestId,
      operation: operationDescription,
    });

    // --- Determine status code and error code ---
    let statusCode = 500;
    // P1-FIX: Declare as ErrorCode (branded union) not plain string. This
    // prevents arbitrary internal strings (e.g. DB driver codes, third-party
    // error.code values) from leaking into API responses as error codes.
    let errorCode: ErrorCode = ErrorCodes.INTERNAL_ERROR;
    let clientMessage: string = 'An error occurred processing your request';

    if (error instanceof AppError) {
      // AppError from packages/errors (ValidationError, NotFoundError, etc.)
      statusCode = error.statusCode;
      errorCode = error.code;
      clientMessage = error.message;
    } else if (
      error instanceof Error &&
      typeof (error as ErrorLike).statusCode === 'number' &&
      typeof (error as ErrorLike).code === 'string'
    ) {
      // Duck-typed errors like AuthError from control-plane/services/auth.ts.
      const typed = error as ErrorLike;
      // P1-FIX: Validate duck-typed statusCode before forwarding. A third-party
      // error with statusCode=0 or statusCode=999 would produce an invalid HTTP
      // response; reject anything outside the 4xx–5xx client/server-error range.
      const candidateStatus = typed.statusCode;
      if (candidateStatus !== undefined && candidateStatus >= 400 && candidateStatus < 600) {
        statusCode = candidateStatus;
      }
      // P1-FIX: Only forward the duck-typed code if it's a known ErrorCode.
      // Anything else (e.g. 'SQLITE_CONSTRAINT', 'ECONNRESET') must not reach
      // the client — fall back to INTERNAL_ERROR for unrecognized values.
      const candidateCode = typed.code;
      const knownCodes = Object.values(ErrorCodes) as string[];
      if (candidateCode !== undefined && knownCodes.includes(candidateCode)) {
        errorCode = candidateCode as ErrorCode;
      }
      clientMessage = error.message;
    }

    // Build the client response
    const response: ErrorResponse = {
      error: clientMessage,
      code: errorCode,
      requestId,
    };

    // Dev mode: attach helpful debugging context
    if (shouldExposeErrorDetails()) {
      const hint = getDevHint(err);
      response.details = {
        operation: operationDescription,
        originalMessage: err.message,
        ...(hint ? { hint } : {}),
        ...(err.cause instanceof Error ? { cause: err.cause.message } : {}),
        ...(error instanceof AppError && error.details ? { errorDetails: error.details } : {}),
      };
    }

    // Set Retry-After header for rate limit errors
    if (error instanceof RateLimitError) {
      void res.header('Retry-After', String(error.retryAfter));
    }

    void res.status(statusCode).send(response);
  };
}

/**
 * Development-mode diagnostic hints based on error patterns.
 * These never appear in production responses.
 */
function getDevHint(error: Error): string | undefined {
  const msg = error.message.toLowerCase();

  if (msg.includes('econnrefused') || msg.includes('connection refused'))
    return 'Check if the database is running. Verify DATABASE_URL in .env.';
  if (msg.includes('enotfound'))
    return 'DNS resolution failed. Check the hostname in your connection string.';
  if (msg.includes('timeout') || msg.includes('etimedout'))
    return 'Operation timed out. Check network connectivity or increase timeout.';
  if (msg.includes('unique constraint') || msg.includes('duplicate key'))
    return 'A record with this unique value already exists. Check for duplicates.';
  if (msg.includes('foreign key constraint'))
    return 'Referenced record does not exist. Ensure parent records are created first.';
  if (msg.includes('permission denied'))
    return 'Database user lacks required permissions. Check grants for your DB user.';
  if (msg.includes('does not exist') && msg.includes('relation'))
    return 'Table or relation not found. Run pending database migrations with: npm run migrate';
  if (msg.includes('invalid input syntax'))
    return 'Invalid data format. Check UUID formats and data types in your request.';
  if (msg.includes('jwt') || msg.includes('token'))
    return 'Authentication token issue. Verify JWT_SECRET and check token expiry.';
  if (msg.includes('stripe'))
    return 'Stripe API error. Verify STRIPE_SECRET_KEY in .env.';
  if (msg.includes('rate limit') || msg.includes('too many requests'))
    return 'Rate limit exceeded. Wait before retrying or increase the limit.';
  if (msg.includes('payload too large') || msg.includes('entity too large'))
    return 'Request body exceeds size limit. Reduce payload size.';

  return undefined;
}
