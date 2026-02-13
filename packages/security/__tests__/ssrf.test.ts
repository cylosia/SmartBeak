/**
 * P1 TEST: SSRF Protection Utility Tests
 *
 * Tests URL validation, internal IP blocking, DNS rebinding protection,
 * protocol/port restrictions, and encoding bypass prevention.
 */

import { describe, it, expect } from 'vitest';
import {
  isInternalIp,
  isAllowedProtocol,
  isAllowedPort,
  validateUrl,
  extractSafeUrl,
  normalizeIp,
} from '../ssrf';

describe('SSRF Protection', () => {
  // ============================================================================
  // isInternalIp
  // ============================================================================

  describe('isInternalIp', () => {
    it('should block IPv4 loopback', () => {
      expect(isInternalIp('127.0.0.1')).toBe(true);
      expect(isInternalIp('127.255.255.255')).toBe(true);
    });

    it('should block localhost', () => {
      expect(isInternalIp('localhost')).toBe(true);
    });

    it('should block RFC1918 10.x.x.x', () => {
      expect(isInternalIp('10.0.0.1')).toBe(true);
      expect(isInternalIp('10.255.255.255')).toBe(true);
    });

    it('should block RFC1918 172.16-31.x.x', () => {
      expect(isInternalIp('172.16.0.1')).toBe(true);
      expect(isInternalIp('172.31.255.255')).toBe(true);
    });

    it('should not block 172.32.x.x (public)', () => {
      expect(isInternalIp('172.32.0.1')).toBe(false);
    });

    it('should block RFC1918 192.168.x.x', () => {
      expect(isInternalIp('192.168.0.1')).toBe(true);
      expect(isInternalIp('192.168.255.255')).toBe(true);
    });

    it('should block link-local 169.254.x.x', () => {
      expect(isInternalIp('169.254.169.254')).toBe(true);
    });

    it('should block 0.0.0.0', () => {
      expect(isInternalIp('0.0.0.0')).toBe(true);
    });

    it('should block IPv6 loopback', () => {
      expect(isInternalIp('::1')).toBe(true);
    });

    it('should allow public IPs', () => {
      expect(isInternalIp('8.8.8.8')).toBe(false);
      expect(isInternalIp('104.16.132.229')).toBe(false);
    });

    it('should detect IPv4-mapped IPv6', () => {
      expect(isInternalIp('::ffff:127.0.0.1')).toBe(true);
    });

    it('should detect decimal-encoded internal IPs', () => {
      // 2130706433 = 127.0.0.1
      expect(isInternalIp('2130706433')).toBe(true);
    });

    it('should detect octal-encoded internal IPs', () => {
      // 0177.0.0.01 = 127.0.0.1
      expect(isInternalIp('0177.0.0.01')).toBe(true);
    });
  });

  // ============================================================================
  // isAllowedProtocol
  // ============================================================================

  describe('isAllowedProtocol', () => {
    it('should allow http:', () => {
      expect(isAllowedProtocol('http:')).toBe(true);
    });

    it('should allow https:', () => {
      expect(isAllowedProtocol('https:')).toBe(true);
    });

    it('should block ftp:', () => {
      expect(isAllowedProtocol('ftp:')).toBe(false);
    });

    it('should block file:', () => {
      expect(isAllowedProtocol('file:')).toBe(false);
    });

    it('should block gopher:', () => {
      expect(isAllowedProtocol('gopher:')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isAllowedProtocol('HTTP:')).toBe(true);
      expect(isAllowedProtocol('HTTPS:')).toBe(true);
    });
  });

  // ============================================================================
  // isAllowedPort
  // ============================================================================

  describe('isAllowedPort', () => {
    it('should allow standard HTTP port 80', () => {
      expect(isAllowedPort(80)).toBe(true);
    });

    it('should allow standard HTTPS port 443', () => {
      expect(isAllowedPort(443)).toBe(true);
    });

    it('should block SSH port 22', () => {
      expect(isAllowedPort(22)).toBe(false);
    });

    it('should block Redis port 6379', () => {
      expect(isAllowedPort(6379)).toBe(false);
    });

    it('should block PostgreSQL port 5432', () => {
      expect(isAllowedPort(5432)).toBe(false);
    });

    it('should block MySQL port 3306', () => {
      expect(isAllowedPort(3306)).toBe(false);
    });

    it('should allow non-standard port 3000', () => {
      expect(isAllowedPort(3000)).toBe(true);
    });
  });

  // ============================================================================
  // validateUrl
  // ============================================================================

  describe('validateUrl', () => {
    it('should allow valid HTTPS URL', () => {
      const result = validateUrl('https://api.example.com/webhook');
      expect(result.allowed).toBe(true);
      expect(result.sanitizedUrl).toBeDefined();
    });

    it('should reject invalid URL format', () => {
      const result = validateUrl('not a url');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Invalid URL');
    });

    it('should reject HTTP when requireHttps is true (default)', () => {
      const result = validateUrl('http://api.example.com/hook');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('HTTPS required');
    });

    it('should allow HTTP when allowHttp is true', () => {
      const result = validateUrl('http://api.example.com/hook', { allowHttp: true });
      expect(result.allowed).toBe(true);
    });

    it('should block internal IP addresses', () => {
      const result = validateUrl('https://127.0.0.1/admin');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Internal IP');
    });

    it('should block localhost', () => {
      const result = validateUrl('https://localhost/api');
      expect(result.allowed).toBe(false);
    });

    it('should block dangerous protocols', () => {
      const result = validateUrl('file:///etc/passwd');
      expect(result.allowed).toBe(false);
    });

    it('should block dangerous ports', () => {
      const result = validateUrl('https://example.com:6379/');
      expect(result.allowed).toBe(false);
    });

    it('should enforce custom allowedPorts', () => {
      const result = validateUrl('https://example.com:9999/', { allowedPorts: [443, 8080] });
      expect(result.allowed).toBe(false);
    });
  });

  // ============================================================================
  // extractSafeUrl
  // ============================================================================

  describe('extractSafeUrl', () => {
    it('should extract valid HTTPS URL', () => {
      const result = extractSafeUrl('https://example.com/page');
      expect(result).toBe('https://example.com/page');
    });

    it('should reject URLs with credentials', () => {
      const result = extractSafeUrl('https://user:pass@example.com/');
      expect(result).toBeNull();
    });

    it('should reject URLs with path traversal', () => {
      const result = extractSafeUrl('https://example.com/../etc/passwd');
      expect(result).toBeNull();
    });

    it('should reject URLs with backslashes', () => {
      const result = extractSafeUrl('https://example.com\\@evil.com');
      expect(result).toBeNull();
    });

    it('should return null for internal URLs', () => {
      const result = extractSafeUrl('https://127.0.0.1/admin');
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // normalizeIp
  // ============================================================================

  describe('normalizeIp', () => {
    it('should normalize IPv4-mapped IPv6', () => {
      expect(normalizeIp('::ffff:192.168.1.1')).toBe('192.168.1.1');
    });

    it('should normalize decimal IP', () => {
      // 3232235777 = 192.168.1.1
      expect(normalizeIp('3232235777')).toBe('192.168.1.1');
    });

    it('should normalize hex-encoded octets', () => {
      expect(normalizeIp('0xC0.0xA8.0x01.0x01')).toBe('192.168.1.1');
    });

    it('should pass through normal IPs', () => {
      expect(normalizeIp('8.8.8.8')).toBe('8.8.8.8');
    });
  });
});
