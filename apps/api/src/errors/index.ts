/**
* Custom Error Classes
*
* Provides standardized error types for the application
*/

/**
* Error thrown when a feature or function is not yet implemented.
* Use this instead of returning mock data to prevent accidental production usage.
*/
export class NotImplementedError extends Error {
  constructor(message: string = 'Feature not yet implemented') {
  super(message);
  this.name = 'NotImplementedError';
  // Fix prototype chain for instanceof checks
  Object.setPrototypeOf(this, NotImplementedError.prototype);
  }
}

/**
* Error thrown when a domain authentication check fails.
*/
export class DomainAuthError extends Error {
  constructor(message: string = 'Domain authentication failed') {
  super(message);
  this.name = 'DomainAuthError';
  Object.setPrototypeOf(this, DomainAuthError.prototype);
  }
}

/**
* Error thrown when CDN transformation fails due to invalid input.
*/
export class CdnTransformError extends Error {
  constructor(message: string = 'CDN transformation failed') {
  super(message);
  this.name = 'CdnTransformError';
  Object.setPrototypeOf(this, CdnTransformError.prototype);
  }
}
