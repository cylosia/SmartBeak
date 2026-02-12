/**
 * Input Validation Utilities
 * Provides safe validation and sanitization functions to prevent various attacks
 *
 * P1-HIGH SECURITY FIXES:
 * - Issue 6: ReDoS vulnerability - Replace regex with character-based sanitization
 * - Issue 7: Missing input validation on query parameters
 * - Issue 8: UUID validation inconsistency
 * - Issue 9: No URL encoding validation
 * - Issue 10: Missing content-type validation
 */

import { z } from 'zod';

// ============================================================================
// UUID Validation
// ============================================================================

/**
 * UUID format pattern (for format checking only, not ReDoS vulnerable)
 * Uses simple character class matching
 */
const UUID_CHAR_PATTERN = /^[0-9a-fA-F-]+$/;

/**
 * Validate UUID format using character-based approach
 * SECURITY FIX: Issue 8 - UUID validation consistency
 *
 * @param value - Value to validate
 * @returns True if valid UUID
 */
export function isValidUUID(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  // Length check first (36 chars for standard UUID)
  if (value.length !== 36) {
    return false;
  }

  // Character validation without complex regex
  if (!UUID_CHAR_PATTERN.test(value)) {
    return false;
  }

  // Position-based validation (8-4-4-4-12 format)
  const parts = value.split('-');
  if (parts.length !== 5) {
    return false;
  }

  const [part1, part2, part3, part4, part5] = parts;
  if (part1?.length !== 8) return false;
  if (part2?.length !== 4) return false;
  if (part3?.length !== 4) return false;
  if (part4?.length !== 4) return false;
  if (part5?.length !== 12) return false;

  // Version check (13th character should be 1-8 for standard UUIDs)
  const version = parseInt(part3?.charAt(0) || '0', 16);
  if (version < 1 || version > 8) {
    return false;
  }

  // Variant check (17th character should be 8, 9, a, or b)
  const variant = part4?.charAt(0).toLowerCase();
  if (!['8', '9', 'a', 'b'].includes(variant || '')) {
    return false;
  }

  return true;
}

/**
 * Normalize UUID to lowercase with consistent format
 * @param value - UUID string to normalize
 * @returns Normalized UUID or null if invalid
 */
export function normalizeUUID(value: string): string | null {
  if (!isValidUUID(value)) {
    return null;
  }
  return value.toLowerCase();
}

// Zod schema for UUID validation
export const UuidSchema = z.string().refine(
  (val) => isValidUUID(val),
  { message: 'Invalid UUID format' }
);

// ============================================================================
// ReDoS-Safe String Sanitization
// ============================================================================

/**
 * Character-based HTML tag sanitizer
 * SECURITY FIX: Issue 6 - Replace regex with character-based sanitization
 *
 * Removes HTML tags without using regex that could be vulnerable to ReDoS
 *
 * @param input - Input string to sanitize
 * @returns Sanitized string with tags removed
 */
export function sanitizeHtmlTags(input: string): string {
  const result: string[] = [];
  let inTag = false;
  let inComment = false;
  let commentBuffer = '';

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const nextChar = input[i + 1];
    const prevChar = input[i - 1];

    // Check for comment start <!--
    if (!inTag && !inComment && char === '<' && nextChar === '!' &&
        input[i + 2] === '-' && input[i + 3] === '-') {
      inComment = true;
      commentBuffer = '<!--';
      i += 3;
      continue;
    }

    // Check for comment end -->
    if (inComment) {
      commentBuffer += char;
      if (char === '>' && prevChar === '-' && input[i - 2] === '-') {
        inComment = false;
        commentBuffer = '';
      }
      continue;
    }

    // Check for tag start
    if (char === '<' && !inTag) {
      inTag = true;
      continue;
    }

    // Check for tag end
    if (char === '>' && inTag) {
      inTag = false;
      continue;
    }

    // Add character if not in tag
    if (!inTag && char !== undefined) {
      result.push(char);
    }
  }

  return result.join('');
}

/**
 * Character-based JavaScript event handler remover
 * SECURITY FIX: Issue 6 - Remove onclick, onerror, etc. without regex
 *
 * @param input - Input string to sanitize
 * @returns Sanitized string with event handlers removed
 */
export function sanitizeEventHandlers(input: string): string {
  const result: string[] = [];
  let i = 0;

  const eventPrefixes = ['on', 'ON', 'On', 'oN'];
  const eventNames = ['click', 'dblclick', 'auxclick', 'contextmenu',
    'error', 'load', 'input',
    'mouseover', 'mouseout', 'mousedown', 'mouseup', 'mousemove', 'mouseenter', 'mouseleave', 'wheel',
    'keydown', 'keyup', 'keypress',
    'pointerdown', 'pointerup', 'pointermove', 'pointerenter', 'pointerleave', 'pointerover', 'pointerout',
    'touchstart', 'touchend', 'touchmove', 'touchcancel',
    'drag', 'dragstart', 'dragend', 'dragover', 'dragenter', 'dragleave', 'drop',
    'submit', 'change', 'focus', 'blur', 'focusin', 'focusout', 'select', 'scroll', 'resize',
    'unload', 'beforeunload', 'hashchange', 'popstate', 'pageshow', 'pagehide',
    'animationstart', 'animationend', 'animationiteration', 'transitionend', 'transitionstart'];

  while (i < input.length) {
    let found = false;

    // Check for event handler pattern
    for (const prefix of eventPrefixes) {
      for (const name of eventNames) {
        const pattern = prefix + name;
        const substr = input.slice(i, i + pattern.length);

        if (substr.toLowerCase() === pattern.toLowerCase()) {
          // Check if followed by = or whitespace then =
          const after = input.slice(i + pattern.length).trimStart();
          if (after.startsWith('=')) {
            // Skip the pattern name
            i += pattern.length;
            // Skip whitespace and the = sign
            while (i < input.length && (input[i] === '=' || input[i] === ' ')) {
              i++;
            }
            // Handle quoted attribute values (e.g., onclick="alert(1) payload")
            if (i < input.length && (input[i] === '"' || input[i] === "'")) {
              const quote = input[i]!;
              i++; // skip opening quote
              while (i < input.length && input[i] !== quote) {
                i++;
              }
              if (i < input.length) {
                i++; // skip closing quote
              }
            } else {
              // Unquoted value - skip until space or >
              while (i < input.length && input[i] !== ' ' && input[i] !== '>') {
                i++;
              }
            }
            found = true;
            break;
          }
        }
      }
      if (found) break;
    }

    if (!found && input[i] !== undefined) {
      result.push(input[i]!);
      i++;
    }
  }

  return result.join('');
}

/**
 * Safe string sanitizer combining multiple techniques
 * SECURITY FIX: Issue 6 - ReDoS-safe sanitization
 *
 * @param input - Input to sanitize
 * @param options - Sanitization options
 * @returns Sanitized string
 */
export function sanitizeString(
  input: unknown,
  options: {
    maxLength?: number;
    removeHtml?: boolean;
    removeScripts?: boolean;
    trim?: boolean;
  } = {}
): string {
  if (input === null || input === undefined) {
    return '';
  }

  let result = String(input);

  // Trim
  if (options.trim !== false) {
    result = result.trim();
  }

  // Remove HTML tags
  if (options.removeHtml !== false) {
    result = sanitizeHtmlTags(result);
  }

  // Remove event handlers
  if (options.removeScripts !== false) {
    result = sanitizeEventHandlers(result);
  }

  // Limit length
  if (options.maxLength && result.length > options.maxLength) {
    result = result.substring(0, options.maxLength);
  }

  return result;
}

// ============================================================================
// URL/URI Validation
// ============================================================================

/**
 * Validate URL encoding without regex
 * SECURITY FIX: Issue 9 - URL encoding validation
 *
 * @param input - Input to check
 * @returns True if valid URL encoding
 */
export function isValidUrlEncoding(input: string): boolean {
  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    // Check for percent encoding
    if (char === '%') {
      // Must have 2 hex digits after
      if (i + 2 >= input.length) {
        return false;
      }

      const hex1 = input[i + 1];
      const hex2 = input[i + 2];

      // Check if both are valid hex digits
      if (!isHexDigit(hex1!) || !isHexDigit(hex2!)) {
        return false;
      }

      i += 2;
    }
  }

  return true;
}

/**
 * Check if character is a valid hex digit
 */
function isHexDigit(char: string): boolean {
  if (char.length !== 1) return false;
  const code = char.charCodeAt(0);
  // 0-9
  if (code >= 48 && code <= 57) return true;
  // A-F
  if (code >= 65 && code <= 70) return true;
  // a-f
  if (code >= 97 && code <= 102) return true;
  return false;
}

/**
 * Decode URL safely with validation
 * SECURITY FIX: Issue 9 - Safe URL decoding
 *
 * @param input - URL-encoded string
 * @returns Decoded string or null if invalid
 */
export function safeDecodeURIComponent(input: string): string | null {
  if (!isValidUrlEncoding(input)) {
    return null;
  }

  try {
    return decodeURIComponent(input);
  } catch {
    return null;
  }
}

/**
 * Validate and normalize URL
 * SECURITY FIX: Issue 9 - URL validation
 *
 * @param input - URL to validate
 * @returns Normalized URL or null if invalid
 */
export function validateAndNormalizeUrl(input: string): string | null {
  // Check for null bytes
  if (input.includes('\x00')) {
    return null;
  }

  // Check URL encoding validity
  if (!isValidUrlEncoding(input)) {
    return null;
  }

  try {
    const url = new URL(input);

    // Only allow http and https
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

// ============================================================================
// Content-Type Validation
// ============================================================================

/**
 * Allowed content types
 * SECURITY FIX: Issue 10 - Content-type validation
 */
const ALLOWED_CONTENT_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
  'text/html',
  'application/xml',
  'text/xml',
  'application/octet-stream',
] as const;

/**
 * Validate Content-Type header
 * SECURITY FIX: Issue 10 - Content-type validation
 *
 * @param contentType - Content-Type header value
 * @returns True if valid
 */
export function isValidContentType(contentType: string): boolean {
  if (!contentType || typeof contentType !== 'string') {
    return false;
  }

  // Extract base type (ignore charset, boundary, etc.)
  const baseType = contentType.split(';')[0]?.trim().toLowerCase();

  if (!baseType) {
    return false;
  }

  // Check against allowlist
  return ALLOWED_CONTENT_TYPES.includes(baseType as typeof ALLOWED_CONTENT_TYPES[number]);
}

/**
 * Get normalized content type
 * @param contentType - Content-Type header value
 * @returns Normalized content type or null
 */
export function getNormalizedContentType(contentType: string): string | null {
  if (!contentType || typeof contentType !== 'string') {
    return null;
  }

  const baseType = contentType.split(';')[0]?.trim().toLowerCase();
  return baseType || null;
}

// ============================================================================
// Query Parameter Validation
// ============================================================================

/**
 * Validate query parameter value
 * SECURITY FIX: Issue 7 - Input validation on query parameters
 *
 * @param value - Parameter value
 * @param options - Validation options
 * @returns Validated value or null
 */
export function validateQueryParam(
  value: unknown,
  options: {
    type?: 'string' | 'number' | 'boolean' | 'uuid';
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp; // Only for simple patterns, avoid complex ReDoS-vulnerable patterns
    allowEmpty?: boolean;
  } = {}
): string | null {
  if (value === null || value === undefined) {
    return options.allowEmpty ? '' : null;
  }

  let strValue = String(value);

  // Type-specific validation
  switch (options.type) {
    case 'number':
      if (isNaN(Number(strValue))) {
        return null;
      }
      break;
    case 'boolean':
      if (!['true', 'false', '1', '0', 'yes', 'no'].includes(strValue.toLowerCase())) {
        return null;
      }
      break;
    case 'uuid':
      if (!isValidUUID(strValue)) {
        return null;
      }
      break;
  }

  // Length validation
  if (options.minLength !== undefined && strValue.length < options.minLength) {
    return null;
  }

  if (options.maxLength !== undefined && strValue.length > options.maxLength) {
    strValue = strValue.substring(0, options.maxLength);
  }

  // Pattern validation (use sparingly)
  if (options.pattern && !options.pattern.test(strValue)) {
    return null;
  }

  return strValue;
}

/**
 * Validate pagination parameters
 * SECURITY FIX: Issue 7 - Safe pagination parameter handling
 *
 * @param params - Query parameters
 * @returns Validated pagination values
 */
export function validatePaginationParams(params: {
  page?: unknown;
  limit?: unknown;
  maxLimit?: number;
}): { page: number; limit: number } {
  const maxLimit = params.maxLimit || 100;

  // Parse page
  let page = 1;
  if (params.page !== undefined) {
    const parsed = parseInt(String(params.page), 10);
    if (!isNaN(parsed) && parsed > 0) {
      page = parsed;
    }
  }

  // Parse limit
  let limit = 20;
  if (params.limit !== undefined) {
    const parsed = parseInt(String(params.limit), 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, maxLimit);
    }
  }

  return { page, limit };
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

export const ValidationSchemas = {
  uuid: UuidSchema,

  queryString: z.string()
    .min(1)
    .max(1000)
    .transform(val => sanitizeString(val, { maxLength: 1000 })),

  pageNumber: z.coerce.number()
    .int()
    .min(1)
    .max(10000)
    .default(1),

  pageLimit: z.coerce.number()
    .int()
    .min(1)
    .max(100)
    .default(20),

  contentType: z.string()
    .refine(val => isValidContentType(val), {
      message: 'Invalid Content-Type'
    }),
};

// ============================================================================
// Export all utilities
// ============================================================================

export default {
};
