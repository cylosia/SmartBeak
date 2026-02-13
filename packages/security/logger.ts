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
