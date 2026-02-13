/**
 * Secure Logging Utilities
 * Prevents sensitive data leakage in logs
 *
 * The core redaction engine now lives in packages/kernel/redaction.ts.
 * This module re-exports the redaction utilities and provides the
 * SecureLogger convenience class for consumers that need it.
 */

import { getLogger } from '../kernel/logger';

// Re-export all redaction utilities from the canonical location
export {
  sanitizeForLogging,
  sanitizeHeaders,
  sanitizeUrl,
  sanitizeErrorMessage,
  isSensitiveField,
  isSensitiveValue,
  maskValue,
  type SanitizedData,
} from '../kernel/redaction';

import {
  sanitizeForLogging,
  sanitizeHeaders,
  sanitizeUrl,
  sanitizeErrorMessage,
} from '../kernel/redaction';

const internalLogger = getLogger('SecurityLogger');
/**
 * Recursively sanitize an object for logging
 * Removes or masks sensitive fields
 * 
 * P0-FIX: Changed return type from T to SanitizedData to properly represent
 * the transformed data structure without unsafe type assertions
 * 
 * @param data - Data to sanitize
 * @param options - Sanitization options
 * @returns Sanitized data
 */
export function sanitizeForLogging<T>(
  data: T,
  options: {
    depth?: number;
    maxDepth?: number;
    redactKeys?: string[];
    maskKeys?: string[];
  } = {}
): SanitizedData {
  const maxDepth = options.maxDepth ?? 10;
  const currentDepth = options.depth ?? 0;
  const redactKeys = options.redactKeys ?? [];
  const maskKeys = options.maskKeys ?? [];
  
  // Prevent excessive recursion
  if (currentDepth > maxDepth) {
    return '[Max Depth Exceeded]';
  }
  
  // Handle null/undefined
  if (data === null || data === undefined) {
    return data as null | undefined;
  }
  
  // Handle strings
  if (typeof data === 'string') {
    // Check if the string itself looks sensitive
    if (isSensitiveValue(data)) {
      return maskValue(data);
    }
    return data;
  }
  
  // Handle numbers, booleans
  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }
  
  // Handle functions (shouldn't be logged)
  if (typeof data === 'function') {
    return '[Function]';
  }
  
  // Handle symbols
  if (typeof data === 'symbol') {
    return '[Symbol]';
  }
  
  // Handle BigInt
  if (typeof data === 'bigint') {
    return data.toString();
  }
  
  // Handle Date
  if (data instanceof Date) {
    return data.toISOString();
  }
  
  // Handle Error
  if (data instanceof Error) {
    return {
      name: data.name,
      message: data.message,
      stack: process.env['NODE_ENV'] === 'development' ? data.stack : undefined,
    };
  }
  
  // Handle RegExp
  if (data instanceof RegExp) {
    return data.toString();
  }
  
  // Handle Map
  if (data instanceof Map) {
    const sanitized: Record<string, SanitizedData> = {};
    for (const [key, value] of data.entries()) {
      const keyStr = String(key);
      if (isSensitiveField(keyStr) || redactKeys.includes(keyStr)) {
        sanitized[keyStr] = '[REDACTED]';
      } else if (maskKeys.includes(keyStr)) {
        sanitized[keyStr] = maskValue(String(value));
      } else {
        sanitized[keyStr] = sanitizeForLogging(value, { ...options, depth: currentDepth + 1 });
      }
    }
    return sanitized;
  }
  
  // Handle Set
  if (data instanceof Set) {
    const sanitized: SanitizedData[] = [];
    for (const item of data) {
      sanitized.push(sanitizeForLogging(item, { ...options, depth: currentDepth + 1 }));
    }
    return sanitized;
  }
  
  // Handle Array
  if (Array.isArray(data)) {
    return data.map(item => 
      sanitizeForLogging(item, { ...options, depth: currentDepth + 1 })
    );
  }
  
  // Handle Object
  const sanitized: Record<string, SanitizedData> = {};
  for (const [key, value] of Object.entries(data)) {
    // Check for sensitive field names
    if (isSensitiveField(key) || redactKeys.includes(key)) {
      sanitized[key] = '[REDACTED]';
    } 
    // Check for fields to mask
    else if (maskKeys.includes(key)) {
      sanitized[key] = typeof value === 'string' ? maskValue(value) : '[MASKED]';
    }
    // Recursively sanitize
    else {
      sanitized[key] = sanitizeForLogging(value, { ...options, depth: currentDepth + 1 });
    }
  }
  
  return sanitized;
}

/**
 * Create a sanitized log entry
 */
export function createLogEntry(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  data?: Record<string, unknown>
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (data) {
    entry["data"] = sanitizeForLogging(data);
  }

  return entry;
/**
 * Sanitize URL for logging
 * Removes sensitive query parameters
 * 
 * @param url - URL to sanitize
 * @returns Sanitized URL string
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    
    // List of sensitive query parameters
    const sensitiveParams = [
      'token', 'access_token', 'refresh_token', 'api_key', 'apikey',
      'secret', 'password', 'key', 'auth', 'session', 'sessid',
      'csrf', 'xsrf', 'nonce', 'sig', 'signature', 'hmac',
    ];
    
    for (const param of sensitiveParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]');
      }
    }
    
    return parsed.toString();
  } catch {
    // If URL parsing fails, return a placeholder
    return '[Invalid URL]';
  }
}

/**
 * Sanitize error message to prevent information leakage
 * SECURITY FIX: Issue 22 - Secrets exposed in error messages
 * 
 * @param error - Error to sanitize
 * @returns Sanitized error message
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (error === null || error === undefined) {
    return 'Unknown error';
  }
  
  let message: string;
  
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = String(error);
  }
  
  // Remove potential secrets from error messages
  const patterns = [
    // API keys
    { pattern: /sk-[a-zA-Z0-9]{24,}/g, replacement: 'sk-***' },
    // Webhook secrets
    { pattern: /whsec_[a-zA-Z0-9]{24,}/g, replacement: 'whsec_***' },
    // JWT tokens
    { pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, replacement: '[JWT]' },
    // Bearer tokens
    { pattern: /Bearer\s+[a-zA-Z0-9_-]+/gi, replacement: 'Bearer ***' },
    // Basic auth
    { pattern: /Basic\s+[a-zA-Z0-9=]+/gi, replacement: 'Basic ***' },
    // Password mentions
    { pattern: /password['"]?\s*[:=]\s*['"]?.[^\s'"]+/gi, replacement: 'password=***' },
    // Secret mentions
    { pattern: /secret['"]?\s*[:=]\s*['"]?.[^\s'"]+/gi, replacement: 'secret=***' },
    // Token mentions
    { pattern: /token['"]?\s*[:=]\s*['"]?.[^\s'"]+/gi, replacement: 'token=***' },
    // Connection strings with passwords
    { pattern: /(postgresql|mysql|mongodb):\/\/[^:@]+:[^@]+@/gi, replacement: '$1://***:***@' },
  ];
  
  for (const { pattern, replacement } of patterns) {
    message = message.replace(pattern, replacement);
  }
  
  return message;
}

/**
 * Secure logger class
 * Wraps console methods with sanitization
 */
export class SecureLogger {
  private context: Record<string, unknown>;

  constructor(context: Record<string, unknown> = {}) {
    const sanitized = sanitizeForLogging(context);
    this.context = (typeof sanitized === 'object' && sanitized !== null && !Array.isArray(sanitized))
      ? sanitized as Record<string, unknown>
      : { _context: sanitized };
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, error?: unknown, data?: Record<string, unknown>): void {
    const sanitizedError = error instanceof Error
      ? { name: error.name, message: sanitizeErrorMessage(error) }
      : { message: sanitizeErrorMessage(error) };

    this.log('error', message, { ...data, error: sanitizedError });
  }

  private log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>
  ): void {
    const entry = createLogEntry(level, message, {
      ...this.context,
      ...data,
    });

    switch (level) {
      case 'debug':
        internalLogger.debug(message, entry);
        break;
      case 'info':
        internalLogger.info(message, entry);
        break;
      case 'warn':
        internalLogger.warn(message, entry);
        break;
      case 'error':
        internalLogger.error(message, undefined, entry);
        break;
    }
  }

  child(additionalContext: Record<string, unknown>): SecureLogger {
    return new SecureLogger({ ...this.context, ...additionalContext });
  }
}

// Export singleton for common use
export const logger = new SecureLogger();

// Default export
export default {
  sanitizeForLogging,
  createLogEntry,
  sanitizeHeaders,
  sanitizeUrl,
  sanitizeErrorMessage,
  SecureLogger,
  logger,
};
