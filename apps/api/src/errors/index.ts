/**
 * Custom Error Classes
 *
 * Extends the canonical AppError base class from @errors for consistent
 * error handling across the global error handler.
 */

import { AppError, ErrorCodes } from '@errors';

/**
 * Error thrown when a feature or function is not yet implemented.
 * Use this instead of returning mock data to prevent accidental production usage.
 */
export class NotImplementedError extends AppError {
  constructor(message: string = 'Feature not yet implemented') {
    super(message, ErrorCodes.INTERNAL_ERROR, 501);
  }
}

/**
 * Error thrown when a domain authentication check fails.
 */
export class DomainAuthError extends AppError {
  constructor(message: string = 'Domain authentication failed') {
    super(message, ErrorCodes.DOMAIN_NOT_OWNED, 403);
  }
}

/**
 * Error thrown when CDN transformation fails due to invalid input.
 */
export class CdnTransformError extends AppError {
  constructor(message: string = 'CDN transformation failed') {
    super(message, ErrorCodes.INTERNAL_ERROR, 500);
  }
}
