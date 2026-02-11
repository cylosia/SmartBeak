/**
 * P1-HIGH SECURITY FIX: Issue 11 & 22 - Information Disclosure via Errors
 * Sanitizes all error messages to remove internal details and secrets
 */

import { FastifyReply } from 'fastify';

/**
 * Standard error response structure
 * SECURITY FIX: Issue 11 - Consistent error response format
 */
export interface SanitizedErrorResponse {
  error: string;
  code: string;
  requestId?: string;
  details?: unknown; // Only in development
}

/**
 * Generate a unique request ID for error tracking
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Patterns for detecting sensitive data in error messages
 * SECURITY FIX: Issue 22 - Detect and redact secrets
 */
const SENSITIVE_PATTERNS = [
  { pattern: /sk-[a-zA-Z0-9]{24,}/g, replacement: 'sk-***' },
  { pattern: /sk_live_[a-zA-Z0-9]{24,}/g, replacement: 'sk_live_***' },
  { pattern: /sk_test_[a-zA-Z0-9]{24,}/g, replacement: 'sk_test_***' },
  { pattern: /whsec_[a-zA-Z0-9]{24,}/g, replacement: 'whsec_***' },
  { pattern: /rk_live_[a-zA-Z0-9]{24,}/g, replacement: 'rk_live_***' },
  { pattern: /rk_test_[a-zA-Z0-9]{24,}/g, replacement: 'rk_test_***' },
  { pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, replacement: '[JWT]' },
  { pattern: /Bearer\s+[a-zA-Z0-9_-]+/gi, replacement: 'Bearer ***' },
  { pattern: /Basic\s+[a-zA-Z0-9=]+/gi, replacement: 'Basic ***' },
  { pattern: /password['"]?\s*[:=]\s*['"]?.[^\s'"]+/gi, replacement: 'password=***' },
  { pattern: /secret['"]?\s*[:=]\s*['"]?.[^\s'"]+/gi, replacement: 'secret=***' },
  { pattern: /token['"]?\s*[:=]\s*['"]?.[^\s'"]+/gi, replacement: 'token=***' },
  { pattern: /api[_-]?key['"]?\s*[:=]\s*['"]?.[^\s'"]+/gi, replacement: 'api_key=***' },
  { pattern: /(postgresql|mysql|mongodb):\/\/[^:@]+:[^@]+@/gi, replacement: '$1://***:***@' },
  { pattern: /[a-f0-9]{64}/gi, replacement: '[API_KEY_HASH]' },
] as const;

/**
 * Sanitize error message to remove secrets
 * SECURITY FIX: Issue 22 - Remove secrets from error messages
 */
export function sanitizeErrorMessage(message: string): string {
  let sanitized = message;
  
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  
  // Remove file paths (information disclosure)
  sanitized = sanitized.replace(/[\w\/\\]+\.(js|ts|json|env)/gi, '[FILE]');
  
  // Remove internal IP addresses
  sanitized = sanitized.replace(/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g, '[INTERNAL_IP]');
  
  return sanitized;
}

/**
 * Sanitize error for client response
 * Removes internal details that could be used for reconnaissance
 * SECURITY FIX: Issue 11 - Consistent error format
 */
export function sanitizeError(
  error: unknown,
  defaultMessage: string = 'An error occurred',
  code: string = 'INTERNAL_ERROR',
  requestId: string = generateRequestId()
): SanitizedErrorResponse {
  // Log full error server-side for debugging (sanitized)
  const sanitizedForLog = error instanceof Error 
    ? { ...error, message: sanitizeErrorMessage(error["message"]) }
    : error;
  console.error(`[Error:${requestId}]`, sanitizedForLog);

  const isDevelopment = process.env.NODE_ENV === 'development';

  // Base response - never expose internal details in production
  const response: SanitizedErrorResponse = {
    error: defaultMessage,
    code,
    requestId
  };

  // In development, include sanitized details
  if (isDevelopment) {
    if (error instanceof Error) {
      response.details = {
        message: sanitizeErrorMessage(error["message"]),
        name: error.name
      };
    } else {
      response.details = sanitizeErrorMessage(String(error));
    }
  }

  return response;
}

/**
 * Database error sanitization
 * Maps database errors to generic messages
 */
export function sanitizeDBError(error: unknown, requestId?: string): SanitizedErrorResponse {
  const reqId = requestId || generateRequestId();
  
  if (error instanceof Error) {
    const message = error["message"].toLowerCase();

    // Connection errors
    if (message.includes('connection') || message.includes('econnrefused') || message.includes('enotfound')) {
      return {
        error: 'Database connection error. Please try again later.',
        code: 'DB_CONNECTION_ERROR',
        requestId: reqId
      };
    }

    // Timeout errors
    if (message.includes('timeout')) {
      return {
        error: 'Request timeout. Please try again.',
        code: 'DB_TIMEOUT_ERROR',
        requestId: reqId
      };
    }

    // Constraint errors
    if (message.includes('unique constraint') || message.includes('duplicate key')) {
      return {
        error: 'A record with this information already exists.',
        code: 'DB_DUPLICATE_ERROR',
        requestId: reqId
      };
    }

    // Foreign key errors
    if (message.includes('foreign key constraint')) {
      return {
        error: 'Referenced record does not exist.',
        code: 'DB_REFERENCE_ERROR',
        requestId: reqId
      };
    }

    // Permission errors
    if (message.includes('permission denied') || message.includes('not permitted')) {
      return {
        error: 'Insufficient permissions for this operation.',
        code: 'DB_PERMISSION_ERROR',
        requestId: reqId
      };
    }

    // Syntax errors (should never happen, but just in case)
    if (message.includes('syntax error')) {
      return {
        error: 'Invalid request.',
        code: 'DB_SYNTAX_ERROR',
        requestId: reqId
      };
    }
  }

  // Default generic error
  return {
    error: 'An unexpected error occurred. Please try again later.',
    code: 'DB_ERROR',
    requestId: reqId
  };
}

/**
 * Send sanitized error response
 * SECURITY FIX: Issue 11 - Consistent error response format
 */
export function sendSanitizedError(
  reply: FastifyReply,
  error: unknown,
  statusCode: number = 500,
  defaultMessage?: string,
  code?: string
): void {
  const sanitized = sanitizeError(error, defaultMessage, code);
  reply.status(statusCode).send(sanitized);
}

/**
 * Common error codes for consistent handling
 * SECURITY FIX: Issue 11 - Standardized error codes
 */
export const ErrorCodes = {
  // 4xx Client Errors
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMIT_EXCEEDED',
  CSRF_INVALID: 'CSRF_INVALID',
  
  // 5xx Server Errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DB_ERROR: 'DB_ERROR',
  DB_CONNECTION_ERROR: 'DB_CONNECTION_ERROR',
  DB_TIMEOUT_ERROR: 'DB_TIMEOUT_ERROR',
  DB_DUPLICATE_ERROR: 'DB_DUPLICATE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  
  // External Service Errors
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
  PAYMENT_ERROR: 'PAYMENT_ERROR',
  STRIPE_ERROR: 'STRIPE_ERROR',
  WEBHOOK_ERROR: 'WEBHOOK_ERROR',
} as const;

/**
 * Sanitize external API errors (Stripe, Paddle, etc.)
 */
export function sanitizeExternalAPIError(
  error: unknown,
  provider: string,
  requestId?: string
): SanitizedErrorResponse {
  const reqId = requestId || generateRequestId();

  // Log the full error server-side (sanitized)
  const sanitizedError = error instanceof Error 
    ? sanitizeErrorMessage(error["message"])
    : sanitizeErrorMessage(String(error));
  console.error(`[${provider} Error:${reqId}]`, sanitizedError);

  // Always return generic message for external API errors
  return {
    error: `${provider} service error. Please try again later.`,
    code: ErrorCodes.EXTERNAL_API_ERROR,
    requestId: reqId
  };
}

// Default export
export default {
  sanitizeError,
  sanitizeDBError,
  sendSanitizedError,
  sanitizeErrorMessage,
  sanitizeExternalAPIError,
  generateRequestId,
  ErrorCodes,
};
