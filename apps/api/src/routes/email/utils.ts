import { FastifyReply } from 'fastify';

/**
* Utility functions for Email Routes
* P2-MEDIUM FIX: Extracted from email.ts God class
*/


/**
* Whitelist fields from an object
* @param obj - Source object
* @param allowedFields - Fields to keep
* @returns Filtered object
*/
export function whitelistFields<T extends Record<string, unknown>>(
  obj: T,
  allowedFields: readonly string[]
): Partial<T> {
  const result: Partial<T> = {};
  for (const key of allowedFields) {
    if (key in obj) {
    const k = key as keyof T;
    result[k] = obj[k];
    }
  }
  return result;
}

/**
* Add security headers to response
* P2-MEDIUM FIX: Added HSTS headers
* @param reply - Fastify reply object
*/
export function addSecurityHeaders(reply: FastifyReply): void {
  // HSTS - HTTP Strict Transport Security
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  // Prevent clickjacking
  reply.header('X-Frame-Options', 'DENY');
  // Prevent MIME type sniffing
  reply.header('X-Content-Type-Options', 'nosniff');
  // XSS Protection
  reply.header('X-XSS-Protection', '1; mode=block');
  // Referrer Policy
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
}
