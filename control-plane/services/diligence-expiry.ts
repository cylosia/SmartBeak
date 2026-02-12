import { getLogger } from '@kernel/logger';

/**
* Diligence Expiry Service
* Validates diligence token expiration
*/

const logger = getLogger('diligence-expiry');

/**
* Diligence session
*/
export interface DiligenceSession {
  id: string;
  expires_at?: Date | string | null;
  token?: string;
  org_id?: string;
  domain_id?: string;
  [key: string]: unknown;
}

/**
* Custom error for diligence expiry
*/
export class DiligenceExpiredError extends Error {
  constructor(message = 'Diligence token expired') {
  super(message);
  this.name = 'DiligenceExpiredError';
  }
}

/**
* Validate diligence session input
*/
function validateDiligenceSession(session: unknown): session is DiligenceSession {
  if (!session || typeof session !== 'object') {
  return false;
  }

  const s = session as Record<string, unknown>;

  // Id is required
  if (typeof s["id"] !== 'string' || s["id"].length === 0) {
  return false;
  }

  // Expires_at is optional but must be valid if provided
  if (s["expires_at"] !== undefined && s["expires_at"] !== null) {
  if (typeof s["expires_at"] !== 'string' && !(s["expires_at"] instanceof Date)) {
    return false;
  }
  }

  return true;
}

/**
* Parse expiration date from various formats
*/
function parseExpirationDate(expiresAt: Date | string | null | undefined): Date | null {
  if (!expiresAt) {
  return null;
  }

  if (expiresAt instanceof Date) {
  return isNaN(expiresAt.getTime()) ? null : expiresAt;
  }

  if (typeof expiresAt === 'string') {
  const parsed = new Date(expiresAt);
  return isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

/**
* Assert that diligence session has not expired
* @param session - Diligence session to validate
* @throws DiligenceExpiredError if session has expired
* @throws Error if session is invalid
*/
export function assertDiligenceNotExpired(session: DiligenceSession): void {
  try {
  // Validate session
  if (!validateDiligenceSession(session)) {
    logger["error"]('Invalid diligence session', new Error('Validation failed'), {
    sessionId: typeof session === 'object' && session !== null ? (session as Record<string, unknown>)['id'] : undefined,
    });
    throw new Error('Invalid diligence session: id is required');
  }

  // Parse expiration date
  const expiresAt = parseExpirationDate(session["expires_at"]);

  // M11-FIX: Sessions without explicit expiry should not live forever.
  // P1-1 SECURITY FIX: Actually enforce the 90-day max (was previously just returning without enforcement).
  if (!expiresAt) {
    logger.warn('Diligence session has no explicit expiry, rejecting for security', { sessionId: session["id"] });
    throw new DiligenceExpiredError(
    'Diligence session has no expiration date. Sessions without explicit expiry are not allowed.'
    );
  }

  const now = new Date();

  // Validate current date
  if (isNaN(now.getTime())) {
    logger["error"]('Invalid system date', new Error('Date validation failed'));
    throw new Error('Invalid system date');
  }

  // Check expiration
  if (expiresAt < now) {
    logger.warn('Diligence token expired', {
    sessionId: session["id"],
    expiredAt: expiresAt.toISOString(),
    now: now.toISOString(),
    });
    throw new DiligenceExpiredError();
  }

  logger.debug('Diligence token validated', {
    sessionId: session["id"],
    expiresAt: expiresAt.toISOString(),
  });
  } catch (error) {
  // Re-throw DiligenceExpiredError and validation errors
  // Check for validation error using error code or message pattern
  const customError = error as Error & { code?: string };
  const isValidationError = error instanceof Error &&
    (customError.code === 'VALIDATION_ERROR' || error.message.includes('Invalid'));
  if (
    error instanceof DiligenceExpiredError || isValidationError
  ) {
    throw error;
  }

  // Log unexpected errors
  logger["error"](
    'Unexpected error checking diligence expiry',
    error instanceof Error ? error : new Error(String(error)),
    { sessionId: 'id' in session ? session['id'] : undefined }
  );
  throw new Error('Failed to validate diligence session');
  }
}

/**
* Check if diligence session is expired (non-throwing version)
* @param session - Diligence session to check
* @returns true if expired or invalid, false if valid and not expired
*/
export function isDiligenceExpired(session: DiligenceSession): boolean {
  try {
  assertDiligenceNotExpired(session);
  return false;
  } catch {
  return true;
  }
}
