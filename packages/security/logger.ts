/**
 * Secure Logging Utilities
 * Prevents sensitive data leakage in logs
 * 
 * P1-HIGH SECURITY FIX: Issue 12 - API keys logged in context data
 * P1-HIGH SECURITY FIX: Issue 22 - Secrets exposed in error messages
 */

import { getLogger } from '../kernel/logger';

const securityLogger = getLogger('SecurityLogger');

// Patterns for detecting sensitive fields
const SENSITIVE_FIELD_PATTERNS = [
  /^password$/i,
  /^passwd$/i,
  /^pwd$/i,
  /^secret$/i,
  /^token$/i,
  /^api[_-]?key$/i,
  /^apikey$/i,
  /^auth[_-]?token$/i,
  /^access[_-]?token$/i,
  /^refresh[_-]?token$/i,
  /^private[_-]?key$/i,
  /^privatekey$/i,
  /^client[_-]?secret$/i,
  /^clientsecret$/i,
  /^session[_-]?id$/i,
  /^sessionid$/i,
  /^jwt$/i,
  /^bearer$/i,
  /^authorization$/i,
  /^cookie$/i,
  /^credit[_-]?card$/i,
  /^cc[_-]?num$/i,
  /^cvv$/i,
  /^ssn$/i,
  /^social[_-]?security$/i,
  /^dob$/i,
  /^birth/i,
  /^pin$/i,
  /_key$/i,
  /_secret$/i,
  /_token$/i,
  /_password$/i,
] as const;

// Patterns for detecting sensitive values
const SENSITIVE_VALUE_PATTERNS = [
  /^sk-[a-zA-Z0-9]{24,}$/,        // Stripe secret key
  /^sk_live_[a-zA-Z0-9]{24,}$/,   // Stripe live key
  /^sk_test_[a-zA-Z0-9]{24,}$/,   // Stripe test key
  /^whsec_[a-zA-Z0-9]{24,}$/,     // Stripe webhook secret
  /^rk_live_[a-zA-Z0-9]{24,}$/,   // Stripe restricted key
  /^rk_test_[a-zA-Z0-9]{24,}$/,   // Stripe restricted test key
  /^[a-zA-Z0-9_-]+\.eyJ/,         // JWT token (starts with header)
  /^Bearer\s+[a-zA-Z0-9_-]+/,     // Bearer token
  /^Basic\s+[a-zA-Z0-9=]+$/,      // Basic auth
  /^[0-9]{16}$/,                   // Potential credit card
  /^[0-9]{3,4}$/,                  // CVV
  /^(ssh-rsa|ssh-ed25519|ecdsa-sha2)/, // SSH keys
  /^-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, // PEM keys
  /^[a-f0-9]{64}$/i,               // API key hash
  /^ghp_[a-zA-Z0-9]{36}$/i,       // GitHub personal access token
  /^gho_[a-zA-Z0-9]{36}$/i,       // GitHub OAuth token
  /^ghu_[a-zA-Z0-9]{36}$/i,       // GitHub user token
  /^ghs_[a-zA-Z0-9]{36}$/i,       // GitHub server-to-server token
  /^ghr_[a-zA-Z0-9]{36}$/i,       // GitHub refresh token
  /^xox[baprs]-[0-9]{10,13}-[0-9]{10,13}(-[a-zA-Z0-9]{24})?$/, // Slack token
  /^[A-Za-z0-9_]{21}--[A-Za-z0-9_]{10}$/, // AWS Access Key ID pattern (partial)
  /^AKIA[0-9A-Z]{16}$/,            // AWS Access Key ID
  /^[A-Za-z0-9/+=]{40}$/,          // AWS Secret Access Key (base64)
] as const;

/**
 * Check if a field name indicates sensitive data
 * @param fieldName - Field name to check
 * @returns True if field is sensitive
 */
function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(fieldName));
}

/**
 * Check if a value looks like sensitive data
 * @param value - Value to check
 * @returns True if value looks sensitive
 */
function isSensitiveValue(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  
  return SENSITIVE_VALUE_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Mask a sensitive value
 * @param value - Value to mask
 * @returns Masked value
 */
function maskValue(value: string): string {
  if (value.length <= 4) {
    return '****';
  }
  
  // Show first 2 and last 2 characters
  return value.substring(0, 2) + '****' + value.substring(value.length - 2);
}

/**
 * Type for sanitized output - represents data that has been processed for logging
 * P0-FIX: Use proper type instead of as unknown as T
 */
export type SanitizedData =
  | string
  | number
  | boolean
  | null
  | undefined
  | SanitizedData[]
  | { [key: string]: SanitizedData };

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
      message: data["message"],
      stack: process.env['NODE_ENV'] === 'development' ? data["stack"] : undefined,
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
 * @param level - Log level
 * @param message - Log message
 * @param data - Additional data to log
 * @returns Sanitized log entry
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
 * Sanitize HTTP headers for logging
 * Removes sensitive header values
 * 
 * @param headers - Headers object
 * @returns Sanitized headers
 */
export function sanitizeHeaders(
  headers: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  
  const sensitiveHeaders = [
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
    'x-csrf-token',
    'x-xsrf-token',
    'x-webhook-secret',
    'x-stripe-signature',
  ];
  
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    
    if (sensitiveHeaders.includes(lowerKey) || isSensitiveField(key)) {
      if (lowerKey === 'authorization') {
        // For Authorization, show the type but not the token
        const strValue = String(value);
        if (strValue.toLowerCase().startsWith('bearer ')) {
          sanitized[key] = 'Bearer [REDACTED]';
        } else if (strValue.toLowerCase().startsWith('basic ')) {
          sanitized[key] = 'Basic [REDACTED]';
        } else {
          sanitized[key] = '[REDACTED]';
        }
      } else {
        sanitized[key] = '[REDACTED]';
      }
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

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
    message = error["message"];
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
    this.context = sanitizeForLogging(context) as Record<string, unknown>;
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
    
    // Use structured logger based on level
    switch (level) {
      case 'debug':
        securityLogger.debug(message, entry);
        break;
      case 'info':
        securityLogger.info(message, entry);
        break;
      case 'warn':
        securityLogger.warn(message, entry);
        break;
      case 'error':
        securityLogger.error(message, undefined, entry);
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
