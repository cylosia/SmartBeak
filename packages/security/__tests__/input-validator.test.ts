/**
 * P1 TEST: Input Validation Utilities Tests
 *
 * Tests UUID validation, HTML sanitization, event handler removal,
 * URL encoding, content-type validation, and query parameter validation.
 */

import { describe, it, expect } from 'vitest';
import {
  isValidUUID,
  normalizeUUID,
  sanitizeHtmlTags,
  sanitizeEventHandlers,
  sanitizeString,
  isValidUrlEncoding,
  safeDecodeURIComponent,
  validateAndNormalizeUrl,
  isValidContentType,
  getNormalizedContentType,
  validateQueryParam,
  validatePaginationParams,
} from '../input-validator';

describe('Input Validation Utilities', () => {
  // ============================================================================
  // UUID Validation
  // ============================================================================

  describe('isValidUUID', () => {
    it('should accept valid UUID v4', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('should accept uppercase UUID', () => {
      expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    });

    it('should reject non-string', () => {
      expect(isValidUUID(123)).toBe(false);
      expect(isValidUUID(null)).toBe(false);
    });

    it('should reject wrong length', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false);
    });

    it('should reject wrong format (missing dashes)', () => {
      expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false);
    });

    it('should reject invalid version (0)', () => {
      expect(isValidUUID('550e8400-e29b-01d4-a716-446655440000')).toBe(false);
    });

    it('should reject invalid variant', () => {
      expect(isValidUUID('550e8400-e29b-41d4-0716-446655440000')).toBe(false);
    });
  });

  describe('normalizeUUID', () => {
    it('should lowercase a valid UUID', () => {
      expect(normalizeUUID('550E8400-E29B-41D4-A716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should return null for invalid UUID', () => {
      expect(normalizeUUID('not-a-uuid')).toBeNull();
    });
  });

  // ============================================================================
  // HTML Sanitization
  // ============================================================================

  describe('sanitizeHtmlTags', () => {
    it('should remove HTML tags', () => {
      expect(sanitizeHtmlTags('<p>Hello</p>')).toBe('Hello');
    });

    it('should remove nested tags', () => {
      expect(sanitizeHtmlTags('<div><span>Text</span></div>')).toBe('Text');
    });

    it('should remove HTML comments', () => {
      expect(sanitizeHtmlTags('Before<!-- comment -->After')).toBe('BeforeAfter');
    });

    it('should handle script tags', () => {
      expect(sanitizeHtmlTags('<script>alert("xss")</script>')).toBe('alert("xss")');
    });

    it('should handle plain text (no tags)', () => {
      expect(sanitizeHtmlTags('Just plain text')).toBe('Just plain text');
    });
  });

  describe('sanitizeEventHandlers', () => {
    it('should remove onclick handler', () => {
      const input = '<div onclick="alert(1)">text</div>';
      const result = sanitizeEventHandlers(input);
      expect(result).not.toContain('onclick');
      expect(result).not.toContain('alert');
    });

    it('should remove onerror handler', () => {
      const input = '<img onerror="alert(1)" src="x">';
      const result = sanitizeEventHandlers(input);
      expect(result).not.toContain('onerror');
    });

    it('should be case-insensitive', () => {
      const input = '<div ONCLICK="bad()">text</div>';
      const result = sanitizeEventHandlers(input);
      expect(result).not.toContain('ONCLICK');
    });

    it('should handle unquoted values', () => {
      const input = '<div onmouseover=alert(1)>text</div>';
      const result = sanitizeEventHandlers(input);
      expect(result).not.toContain('onmouseover');
    });
  });

  describe('sanitizeString', () => {
    it('should trim by default', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
    });

    it('should handle null/undefined', () => {
      expect(sanitizeString(null)).toBe('');
      expect(sanitizeString(undefined)).toBe('');
    });

    it('should enforce maxLength', () => {
      const result = sanitizeString('hello world', { maxLength: 5 });
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should remove HTML when removeHtml is true', () => {
      expect(sanitizeString('<b>bold</b>')).toBe('bold');
    });

    it('should convert non-string to string', () => {
      expect(sanitizeString(42)).toBe('42');
    });
  });

  // ============================================================================
  // URL Encoding Validation
  // ============================================================================

  describe('isValidUrlEncoding', () => {
    it('should accept valid percent-encoding', () => {
      expect(isValidUrlEncoding('hello%20world')).toBe(true);
    });

    it('should reject incomplete percent-encoding', () => {
      expect(isValidUrlEncoding('hello%2')).toBe(false);
    });

    it('should reject invalid hex in percent-encoding', () => {
      expect(isValidUrlEncoding('hello%ZZ')).toBe(false);
    });

    it('should accept string without percent-encoding', () => {
      expect(isValidUrlEncoding('plain-text')).toBe(true);
    });
  });

  describe('safeDecodeURIComponent', () => {
    it('should decode valid encoded string', () => {
      expect(safeDecodeURIComponent('hello%20world')).toBe('hello world');
    });

    it('should return null for invalid encoding', () => {
      expect(safeDecodeURIComponent('hello%ZZ')).toBeNull();
    });
  });

  describe('validateAndNormalizeUrl', () => {
    it('should accept valid HTTPS URL', () => {
      expect(validateAndNormalizeUrl('https://example.com')).toBe('https://example.com/');
    });

    it('should accept HTTP URL', () => {
      expect(validateAndNormalizeUrl('http://example.com')).toBe('http://example.com/');
    });

    it('should reject FTP URL', () => {
      expect(validateAndNormalizeUrl('ftp://example.com')).toBeNull();
    });

    it('should reject null bytes', () => {
      expect(validateAndNormalizeUrl('https://example.com/\x00path')).toBeNull();
    });

    it('should reject invalid URLs', () => {
      expect(validateAndNormalizeUrl('not a url')).toBeNull();
    });
  });

  // ============================================================================
  // Content-Type Validation
  // ============================================================================

  describe('isValidContentType', () => {
    it('should accept application/json', () => {
      expect(isValidContentType('application/json')).toBe(true);
    });

    it('should accept with charset', () => {
      expect(isValidContentType('application/json; charset=utf-8')).toBe(true);
    });

    it('should accept multipart/form-data', () => {
      expect(isValidContentType('multipart/form-data; boundary=---')).toBe(true);
    });

    it('should reject unknown content type', () => {
      expect(isValidContentType('application/x-evil')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidContentType('')).toBe(false);
    });
  });

  describe('getNormalizedContentType', () => {
    it('should return base type without params', () => {
      expect(getNormalizedContentType('text/html; charset=utf-8')).toBe('text/html');
    });

    it('should return null for empty input', () => {
      expect(getNormalizedContentType('')).toBeNull();
    });
  });

  // ============================================================================
  // Query Parameter Validation
  // ============================================================================

  describe('validateQueryParam', () => {
    it('should validate string type', () => {
      expect(validateQueryParam('hello', { type: 'string' })).toBe('hello');
    });

    it('should validate number type', () => {
      expect(validateQueryParam('42', { type: 'number' })).toBe('42');
      expect(validateQueryParam('not-num', { type: 'number' })).toBeNull();
    });

    it('should validate boolean type', () => {
      expect(validateQueryParam('true', { type: 'boolean' })).toBe('true');
      expect(validateQueryParam('yes', { type: 'boolean' })).toBe('yes');
      expect(validateQueryParam('maybe', { type: 'boolean' })).toBeNull();
    });

    it('should validate UUID type', () => {
      expect(validateQueryParam('550e8400-e29b-41d4-a716-446655440000', { type: 'uuid' })).toBeTruthy();
      expect(validateQueryParam('not-uuid', { type: 'uuid' })).toBeNull();
    });

    it('should enforce minLength', () => {
      expect(validateQueryParam('hi', { minLength: 5 })).toBeNull();
    });

    it('should enforce maxLength by truncating', () => {
      const result = validateQueryParam('hello world', { maxLength: 5 });
      expect(result).toBe('hello');
    });

    it('should return null for null/undefined without allowEmpty', () => {
      expect(validateQueryParam(null)).toBeNull();
      expect(validateQueryParam(undefined)).toBeNull();
    });

    it('should return empty string for null with allowEmpty', () => {
      expect(validateQueryParam(null, { allowEmpty: true })).toBe('');
    });
  });

  describe('validatePaginationParams', () => {
    it('should return defaults for empty params', () => {
      const result = validatePaginationParams({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should parse valid page and limit', () => {
      const result = validatePaginationParams({ page: '3', limit: '50' });
      expect(result.page).toBe(3);
      expect(result.limit).toBe(50);
    });

    it('should enforce maxLimit', () => {
      const result = validatePaginationParams({ limit: '200', maxLimit: 100 });
      expect(result.limit).toBe(100);
    });

    it('should handle non-numeric page', () => {
      const result = validatePaginationParams({ page: 'abc' });
      expect(result.page).toBe(1);
    });

    it('should handle negative page', () => {
      const result = validatePaginationParams({ page: '-1' });
      expect(result.page).toBe(1);
    });
  });
});
