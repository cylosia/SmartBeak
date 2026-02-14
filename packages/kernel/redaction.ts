/**
 * Sensitive Data Redaction Engine
 * Consolidated from packages/security/logger.ts and packages/kernel/logger.ts.
 *
 * Provides comprehensive field-name and value-pattern redaction for all logging.
 * Prevents sensitive data leakage (API keys, JWTs, secrets) in log output.
 */

// Patterns for detecting sensitive fields (by key name)
const SENSITIVE_FIELD_PATTERNS: readonly RegExp[] = [
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
];

// Patterns for detecting sensitive values (by content)
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /^sk-[a-zA-Z0-9]{24,}$/,        // Stripe secret key
  /^sk_live_[a-zA-Z0-9]{24,}$/,   // Stripe live key
  /^sk_test_[a-zA-Z0-9]{24,}$/,   // Stripe test key
  /^whsec_[a-zA-Z0-9]{24,}$/,     // Stripe webhook secret
  /^rk_live_[a-zA-Z0-9]{24,}$/,   // Stripe restricted key
  /^rk_test_[a-zA-Z0-9]{24,}$/,   // Stripe restricted test key
  /^[a-zA-Z0-9_-]+\.eyJ/,         // JWT token
  /^Bearer\s+[a-zA-Z0-9_-]+/,     // Bearer token
  /^Basic\s+[a-zA-Z0-9=]+$/,      // Basic auth
  /^[0-9]{16}$/,                   // Potential credit card
  /^[0-9]{3,4}$/,                  // CVV
  /^(ssh-rsa|ssh-ed25519|ecdsa-sha2)/, // SSH keys
  /^-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, // PEM keys
  /^[a-f0-9]{64}$/i,              // API key hash
  /^ghp_[a-zA-Z0-9]{36}$/i,      // GitHub personal access token
  /^gho_[a-zA-Z0-9]{36}$/i,      // GitHub OAuth token
  /^ghu_[a-zA-Z0-9]{36}$/i,      // GitHub user token
  /^ghs_[a-zA-Z0-9]{36}$/i,      // GitHub server-to-server token
  /^ghr_[a-zA-Z0-9]{36}$/i,      // GitHub refresh token
  /^xox[baprs]-[0-9]{10,13}-[0-9]{10,13}(-[a-zA-Z0-9]{24})?$/, // Slack token
  /^[A-Za-z0-9_]{21}--[A-Za-z0-9_]{10}$/, // AWS Access Key ID pattern
  /^AKIA[0-9A-Z]{16}$/,           // AWS Access Key ID
  /^[A-Za-z0-9/+=]{40}$/,         // AWS Secret Access Key (base64)
];

/**
 * Check if a field name indicates sensitive data
 */
export function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(fieldName));
}

/**
 * Check if a value looks like sensitive data
 */
export function isSensitiveValue(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return SENSITIVE_VALUE_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Mask a sensitive value, showing only first 2 and last 2 characters
 */
export function maskValue(value: string): string {
  if (value.length <= 8) {
    return '****';
  }
  return value.substring(0, 2) + '****' + value.substring(value.length - 2);
}

/** Type for sanitized output */
export type SanitizedData =
  | string
  | number
  | boolean
  | null
  | undefined
  | SanitizedData[]
  | { [key: string]: SanitizedData };

/**
 * Recursively sanitize an object for logging.
 * Removes or masks sensitive fields and values.
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

  if (currentDepth > maxDepth) {
    return '[Max Depth Exceeded]';
  }

  if (data === null || data === undefined) {
    return data as null | undefined;
  }

  if (typeof data === 'string') {
    if (isSensitiveValue(data)) {
      return maskValue(data);
    }
    return data;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  if (typeof data === 'function') {
    return '[Function]';
  }

  if (typeof data === 'symbol') {
    return '[Symbol]';
  }

  if (typeof data === 'bigint') {
    return data.toString();
  }

  if (data instanceof Date) {
    return data.toISOString();
  }

  if (data instanceof Error) {
    return {
      name: data.name,
      message: data.message,
      stack: process.env['NODE_ENV'] === 'development' ? data.stack : undefined,
    };
  }

  if (data instanceof RegExp) {
    return data.toString();
  }

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

  if (data instanceof Set) {
    const sanitized: SanitizedData[] = [];
    for (const item of data) {
      sanitized.push(sanitizeForLogging(item, { ...options, depth: currentDepth + 1 }));
    }
    return sanitized;
  }

  if (Array.isArray(data)) {
    return data.map(item =>
      sanitizeForLogging(item, { ...options, depth: currentDepth + 1 })
    );
  }

  // Handle plain objects
  const sanitized: Record<string, SanitizedData> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveField(key) || redactKeys.includes(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (maskKeys.includes(key)) {
      sanitized[key] = typeof value === 'string' ? maskValue(value) : '[MASKED]';
    } else {
      sanitized[key] = sanitizeForLogging(value, { ...options, depth: currentDepth + 1 });
    }
  }

  return sanitized;
}

/**
 * Sanitize HTTP headers for logging.
 * Removes sensitive header values while preserving auth type hints.
 */
export function sanitizeHeaders(
  headers: Record<string, unknown>
): Record<string, unknown> {
  const sensitiveHeaders = [
    'authorization', 'cookie', 'set-cookie',
    'x-api-key', 'x-auth-token', 'x-csrf-token',
    'x-xsrf-token', 'x-webhook-secret', 'x-stripe-signature',
  ];

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    if (sensitiveHeaders.includes(lowerKey) || isSensitiveField(key)) {
      if (lowerKey === 'authorization') {
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
 * Sanitize URL for logging by redacting sensitive query parameters.
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
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
    return '[Invalid URL]';
  }
}

/**
 * Sanitize error message to prevent information leakage.
 * Strips API keys, JWTs, connection strings, and other secrets from error text.
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

  const patterns = [
    { pattern: /sk-[a-zA-Z0-9]{24,}/g, replacement: 'sk-***' },
    { pattern: /whsec_[a-zA-Z0-9]{24,}/g, replacement: 'whsec_***' },
    { pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, replacement: '[JWT]' },
    { pattern: /Bearer\s+[a-zA-Z0-9_-]+/gi, replacement: 'Bearer ***' },
    { pattern: /Basic\s+[a-zA-Z0-9=]+/gi, replacement: 'Basic ***' },
    { pattern: /password['"]?\s*[:=]\s*['"]?.[^\s'"]+/gi, replacement: 'password=***' },
    { pattern: /secret['"]?\s*[:=]\s*['"]?.[^\s'"]+/gi, replacement: 'secret=***' },
    { pattern: /token['"]?\s*[:=]\s*['"]?.[^\s'"]+/gi, replacement: 'token=***' },
    { pattern: /(postgresql|mysql|mongodb):\/\/[^:@]+:[^@]+@/gi, replacement: '$1://***:***@' },
  ];

  for (const { pattern, replacement } of patterns) {
    message = message.replace(pattern, replacement);
  }

  return message;
}
