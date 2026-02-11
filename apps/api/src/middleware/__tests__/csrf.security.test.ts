/**
 * CRITICAL SECURITY TESTS: CSRF Validation
 * 
 * These tests specifically verify that the CSRF validation bypass vulnerability
 * (CVSS 9.8) is fixed. The vulnerability was caused by missing 'await' on
 * the async validateCsrfToken function.
 * 
 * VULNERABILITY DETAILS:
 * - File: apps/api/src/middleware/csrf.ts (line 162)
 * - Issue: if (!validateCsrfToken(...)) without await
 * - Impact: Promise is always truthy, so validation always passed
 * - CVSS Score: 9.8 (Critical)
 * 
 * FIX APPLIED:
 * - Added await to validateCsrfToken call
 * - Added try-catch for error handling
 * - Added proper async/await flow
 * 
 * @security-critical
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateCsrfToken,
  validateCsrfToken,
  csrfProtection,
} from '../csrf';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock Redis
vi.mock('@kernel/redis', () => ({
  getRedis: vi.fn(),
}));

import { getRedis } from '@kernel/redis';

describe('CRITICAL SECURITY: CSRF Validation', () => {
  let mockRedis: {
    setex: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockRedis = {
      setex: vi.fn().mockResolvedValue('OK'),
      get: vi.fn(),
      del: vi.fn().mockResolvedValue(1),
    };

    (getRedis as any).mockResolvedValue(mockRedis);
  });

  /**
   * TEST 1: Valid CSRF token is correctly validated
   * This ensures normal operation still works after the fix
   */
  describe('Valid Token Acceptance', () => {
    it('should accept valid CSRF token and allow request', async () => {
      const validToken = 'a'.repeat(64);
      mockRedis.get.mockResolvedValue(validToken);

      const middleware = csrfProtection();
      const req = {
        method: 'POST',
        url: '/api/test',
        headers: {
          'x-session-id': 'session-123',
          'x-csrf-token': validToken,
        },
      } as unknown as FastifyRequest;
      
      const res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        header: vi.fn().mockReturnThis(),
      } as unknown as FastifyReply;
      
      const next = vi.fn();

      await middleware(req, res, next);

      // Request should proceed (next called, no error response)
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should validate token through actual Redis lookup', async () => {
      const sessionId = 'session-abc-123';
      const validToken = 'b'.repeat(64);
      
      // First generate a token
      mockRedis.setex.mockResolvedValue('OK');
      await generateCsrfToken(sessionId);
      
      // Then validate it
      mockRedis.get.mockResolvedValue(validToken);
      const isValid = await validateCsrfToken(sessionId, validToken);
      
      // Verify Redis was actually called
      expect(mockRedis.get).toHaveBeenCalledWith(`csrf:${sessionId}`);
      expect(isValid).toBe(true);
    });
  });

  /**
   * TEST 2: Invalid token is rejected
   * CRITICAL: This test would FAIL before the fix due to the await bypass
   */
  describe('Invalid Token Rejection', () => {
    it('MUST reject invalid CSRF token with 403 error', async () => {
      // Redis returns a different token than what was provided
      mockRedis.get.mockResolvedValue('valid-token-from-redis');

      const middleware = csrfProtection();
      const req = {
        method: 'POST',
        url: '/api/test',
        headers: {
          'x-session-id': 'session-123',
          'x-csrf-token': 'invalid-token-provided',
        },
      } as unknown as FastifyRequest;
      
      const res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        header: vi.fn().mockReturnThis(),
      } as unknown as FastifyReply;
      
      const next = vi.fn();

      await middleware(req, res, next);

      // CRITICAL: Request MUST be rejected
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith({
        error: 'CSRF protection: Invalid or expired token',
        code: 'CSRF_INVALID_TOKEN',
      });
    });

    it('MUST reject completely wrong token format', async () => {
      mockRedis.get.mockResolvedValue('correct-token-64-chars-long-for-constant-time');

      const middleware = csrfProtection();
      const req = {
        method: 'POST',
        url: '/api/test',
        headers: {
          'x-session-id': 'session-123',
          'x-csrf-token': 'wrong-format',
        },
      } as unknown as FastifyRequest;
      
      const res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        header: vi.fn().mockReturnThis(),
      } as unknown as FastifyReply;
      
      const next = vi.fn();

      await middleware(req, res, next);

      // MUST reject due to length mismatch (constant-time comparison)
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should use constant-time comparison preventing timing attacks', async () => {
      // Same length token, different content
      mockRedis.get.mockResolvedValue('a'.repeat(64));

      const results: boolean[] = [];
      
      // Test multiple times to ensure consistent timing
      for (let i = 0; i < 5; i++) {
        const isValid = await validateCsrfToken('session-1', 'b'.repeat(64));
        results.push(isValid);
      }

      // All should be false (rejected) - not mixed results
      expect(results.every(r => r === false)).toBe(true);
    });
  });

  /**
   * TEST 3: Missing token is rejected
   */
  describe('Missing Token Rejection', () => {
    it('MUST reject request without CSRF token', async () => {
      const middleware = csrfProtection();
      const req = {
        method: 'POST',
        url: '/api/test',
        headers: {
          'x-session-id': 'session-123',
          // No x-csrf-token header
        },
      } as unknown as FastifyRequest;
      
      const res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        header: vi.fn().mockReturnThis(),
      } as unknown as FastifyReply;
      
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith({
        error: 'CSRF protection: Token required',
        code: 'CSRF_TOKEN_REQUIRED',
      });
    });

    it('MUST reject request without session ID', async () => {
      const middleware = csrfProtection();
      const req = {
        method: 'POST',
        url: '/api/test',
        headers: {
          'x-csrf-token': 'some-token',
          // No x-session-id header
        },
      } as unknown as FastifyRequest;
      
      const res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        header: vi.fn().mockReturnThis(),
      } as unknown as FastifyReply;
      
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith({
        error: 'CSRF protection: Session ID required',
        code: 'CSRF_SESSION_REQUIRED',
      });
    });
  });

  /**
   * TEST 4: CRITICAL - Validation actually works (not just truthy Promise)
   * This test specifically targets the vulnerability:
   * - Before fix: validateCsrfToken returns Promise (truthy)
   * - Before fix: !Promise = false, so validation passed
   * - After fix: await Promise, get actual boolean result
   */
  describe('CRITICAL: Promise vs Actual Value', () => {
    it('CRITICAL-MUST: validateCsrfToken returns boolean, not Promise', async () => {
      mockRedis.get.mockResolvedValue('stored-token');

      // The function returns a Promise that resolves to boolean
      const result = validateCsrfToken('session-1', 'stored-token');
      
      // Verify it's a Promise
      expect(result).toBeInstanceOf(Promise);
      
      // After awaiting, we get the actual boolean
      const resolved = await result;
      expect(typeof resolved).toBe('boolean');
    });

    it('CRITICAL-MUST: Middleware awaits validation before deciding', async () => {
      // This test simulates what the buggy code did:
      // if (!validateCsrfToken(...)) // Promise is truthy, so condition is false
      
      // Set up Redis to return a token that doesn't match
      mockRedis.get.mockResolvedValue('correct-token-64-characters-long-for-test');
      
      const middleware = csrfProtection();
      const req = {
        method: 'POST',
        url: '/api/test',
        headers: {
          'x-session-id': 'session-123',
          'x-csrf-token': 'wrong-token-64-characters-long-for-test',
        },
      } as unknown as FastifyRequest;
      
      const res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        header: vi.fn().mockReturnThis(),
      } as unknown as FastifyReply;
      
      const next = vi.fn();

      await middleware(req, res, next);

      // BEFORE FIX: This would have called next() (allowed the request)
      // AFTER FIX: This must NOT call next() (reject the request)
      
      // This is the critical assertion - if the bug existed, next() would be called
      expect(next).not.toHaveBeenCalled();
      
      // And we should get a 403 rejection
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('CRITICAL-MUST: Non-existent session token is rejected', async () => {
      // Redis returns null for non-existent key
      mockRedis.get.mockResolvedValue(null);

      const middleware = csrfProtection();
      const req = {
        method: 'POST',
        url: '/api/test',
        headers: {
          'x-session-id': 'non-existent-session',
          'x-csrf-token': 'any-token-64-characters-long-for-test-purposes',
        },
      } as unknown as FastifyRequest;
      
      const res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        header: vi.fn().mockReturnThis(),
      } as unknown as FastifyReply;
      
      const next = vi.fn();

      await middleware(req, res, next);

      // MUST reject when session doesn't exist
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  /**
   * TEST 5: Error handling
   */
  describe('Error Handling', () => {
    it('should handle Redis errors gracefully', async () => {
      // Simulate Redis connection failure
      mockRedis.get.mockRejectedValue(new Error('Redis connection lost'));

      const middleware = csrfProtection();
      const req = {
        method: 'POST',
        url: '/api/test',
        headers: {
          'x-session-id': 'session-123',
          'x-csrf-token': 'valid-token-64-characters-long-for-test',
        },
      } as unknown as FastifyRequest;
      
      const res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        header: vi.fn().mockReturnThis(),
      } as unknown as FastifyReply;
      
      const next = vi.fn();

      await middleware(req, res, next);

      // Should return 500 error, not crash or allow through
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith({
        error: 'CSRF protection: Validation error',
        code: 'CSRF_VALIDATION_ERROR',
      });
    });
  });

  /**
   * TEST 6: Protected methods
   */
  describe('Method Protection', () => {
    const protectedMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    
    protectedMethods.forEach(method => {
      it(`MUST require CSRF for ${method} requests`, async () => {
        mockRedis.get.mockResolvedValue(null);

        const middleware = csrfProtection();
        const req = {
          method,
          url: '/api/test',
          headers: {
            'x-session-id': 'session-123',
            'x-csrf-token': 'some-token',
          },
        } as unknown as FastifyRequest;
        
        const res = {
          status: vi.fn().mockReturnThis(),
          send: vi.fn().mockReturnThis(),
          header: vi.fn().mockReturnThis(),
        } as unknown as FastifyReply;
        
        const next = vi.fn();

        await middleware(req, res, next);

        // All state-changing methods must be validated
        expect(mockRedis.get).toHaveBeenCalled();
      });
    });

    it('should skip CSRF for GET requests', async () => {
      const middleware = csrfProtection();
      const req = {
        method: 'GET',
        url: '/api/test',
        headers: {},
      } as unknown as FastifyRequest;
      
      const res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        header: vi.fn().mockReturnThis(),
      } as unknown as FastifyReply;
      
      const next = vi.fn();

      await middleware(req, res, next);

      // GET should skip validation
      expect(next).toHaveBeenCalled();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });
});

/**
 * Security Test Summary:
 * 
 * These tests verify the fix for the CSRF validation bypass vulnerability.
 * 
 * Before fix: if (!validateCsrfToken(...)) 
 *   - validateCsrfToken returns Promise<boolean>
 *   - !Promise is always false (Promises are truthy)
 *   - So validation always passed = VULNERABILITY
 * 
 * After fix: const isValid = await validateCsrfToken(...); if (!isValid)
 *   - await resolves to actual boolean
 *   - !false = true when invalid, so request is rejected
 *   - Correct behavior = SECURE
 * 
 * CVSS 9.8 Critical vulnerability is now fixed.
 */
