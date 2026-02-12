/**
* Custom Error Classes
*
* Provides standardized error types for the application
*/

/**
* Base application error with HTTP status code and safe serialization.
* Strips stack traces in production to prevent information leakage.
*/
export class AppError extends Error {
  constructor(
  message: string,
  public readonly statusCode: number = 500,
  public readonly isOperational: boolean = true
  ) {
  super(message);
  this.name = 'AppError';
  Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): { name: string; message: string; statusCode: number; stack?: string } {
  return {
    name: this.name,
    message: this.message,
    statusCode: this.statusCode,
    ...(process.env['NODE_ENV'] === 'development' ? { stack: this.stack } : {}),
  };
  }
}

/**
* Error thrown when a feature or function is not yet implemented.
* Use this instead of returning mock data to prevent accidental production usage.
*/
export class NotImplementedError extends AppError {
  constructor(message: string = 'Feature not yet implemented') {
  super(message, 501);
  this.name = 'NotImplementedError';
  }
}

/**
* Error thrown when a domain authentication check fails.
*/
export class DomainAuthError extends AppError {
  constructor(message: string = 'Domain authentication failed') {
  super(message, 422);
  this.name = 'DomainAuthError';
  }
}

/**
* Error thrown when CDN transformation fails due to invalid input.
*/
export class CdnTransformError extends AppError {
  constructor(message: string = 'CDN transformation failed') {
  super(message, 400);
  this.name = 'CdnTransformError';
  }
}
