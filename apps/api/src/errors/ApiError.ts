import { AppError, ErrorCodes } from '@errors';

/**
 * External API error with HTTP status code and retry information.
 *
 * Represents failures from third-party APIs (YouTube, LinkedIn, etc.).
 * Extends AppError so it integrates with the global error handler and
 * sanitizeErrorForClient() strips internal details in production.
 *
 * The HTTP status code passed to the constructor becomes the AppError
 * statusCode so callers can inspect it for retry decisions.
 */
export class ApiError extends AppError {
  readonly retryAfter?: string | undefined;
  /** Truncated response body for debugging (max 1024 chars) */
  readonly responseBody?: string | undefined;

  constructor(
    message: string,
    status: number,
    retryAfter?: string | undefined,
    responseBody?: string | undefined,
  ) {
    // Map HTTP status to the closest internal ErrorCode so the global
    // error handler can produce structured responses.
    // Audit fix: 400 and 401 were previously falling through to INTERNAL_ERROR,
    // causing auth failures and bad-request errors from external APIs to be
    // classified as internal infrastructure errors in monitoring/alerting.
    const code =
      status === 400 ? ErrorCodes.VALIDATION_ERROR :
      status === 401 ? ErrorCodes.UNAUTHORIZED :
      status === 422 ? ErrorCodes.VALIDATION_ERROR :
      status === 429 ? ErrorCodes.RATE_LIMIT_EXCEEDED :
      status === 403 ? ErrorCodes.FORBIDDEN :
      status === 404 ? ErrorCodes.NOT_FOUND :
      status >= 500 ? ErrorCodes.SERVICE_UNAVAILABLE :
      ErrorCodes.INTERNAL_ERROR;

    super(message, code, status);
    this.retryAfter = retryAfter;
    this.responseBody = responseBody?.slice(0, 1024);
    this.name = this.constructor.name;
  }
}
