/**
 * Standardized API response helpers.
 *
 * Every error response from every route MUST conform to the canonical shape:
 * { error: string, code: string, requestId: string, details?: unknown, retryAfter?: number }
 *
 * Use these helpers instead of ad-hoc res.status(...).send({ error: ... }) calls.
 */

import type { FastifyReply } from 'fastify';
import { ErrorCodes, type ErrorCode, type ErrorResponse } from './index.js';

/**
 * Send a standardized error response.
 * Reads X-Request-ID from the request (set by request-logger middleware).
 * Sets Retry-After header when retryAfter is provided.
 * Only includes `details` in development.
 */
export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ErrorCode,
  message: string,
  opts?: { details?: unknown; retryAfter?: number }
): FastifyReply {
  const rawRequestId = reply.request.headers['x-request-id'];
  const requestId = (typeof rawRequestId === 'string' ? rawRequestId : Array.isArray(rawRequestId) ? rawRequestId[0] : undefined) ?? '';
  const isDevelopment = process.env['NODE_ENV'] === 'development';
  const body: ErrorResponse & { retryAfter?: number } = {
    error: message,
    code,
    requestId,
  };
  if (opts?.details !== undefined && isDevelopment) {
    body.details = opts.details;
  }
  if (opts?.retryAfter !== undefined) {
    body.retryAfter = opts.retryAfter;
    void reply.header('Retry-After', String(opts.retryAfter));
  }
  return reply.status(statusCode).send(body);
}

/** Convenience helpers for common error responses. */
export const errors = {
  badRequest: (reply: FastifyReply, msg = 'Bad request', code: ErrorCode = ErrorCodes.VALIDATION_ERROR, details?: unknown) =>
    sendError(reply, 400, code, msg, { details }),

  unauthorized: (reply: FastifyReply, msg = 'Authentication required') =>
    sendError(reply, 401, ErrorCodes.AUTH_REQUIRED, msg),

  forbidden: (reply: FastifyReply, msg = 'Access denied', code: ErrorCode = ErrorCodes.FORBIDDEN) =>
    sendError(reply, 403, code, msg),

  notFound: (reply: FastifyReply, resource = 'Resource', code: ErrorCode = ErrorCodes.NOT_FOUND) =>
    sendError(reply, 404, code, `${resource} not found`),

  conflict: (reply: FastifyReply, msg = 'Resource conflict', code: ErrorCode = ErrorCodes.CONFLICT) =>
    sendError(reply, 409, code, msg),

  validationFailed: (reply: FastifyReply, details?: unknown) =>
    sendError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Validation failed', { details }),

  rateLimited: (reply: FastifyReply, retryAfter: number, msg = 'Too many requests') =>
    sendError(reply, 429, ErrorCodes.RATE_LIMIT_EXCEEDED, msg, { retryAfter }),

  payloadTooLarge: (reply: FastifyReply, msg = 'Request payload too large') =>
    sendError(reply, 413, ErrorCodes.PAYLOAD_TOO_LARGE, msg),

  internal: (reply: FastifyReply, msg = 'An error occurred processing your request') =>
    sendError(reply, 500, ErrorCodes.INTERNAL_ERROR, msg),

  serviceUnavailable: (reply: FastifyReply, msg = 'Service temporarily unavailable') =>
    sendError(reply, 503, ErrorCodes.SERVICE_UNAVAILABLE, msg),
} as const;
