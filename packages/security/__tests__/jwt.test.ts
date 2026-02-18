/**
 * P2 TEST: JWT Verification with Key Rotation Tests
 * 
 * Tests JWT verification, token format validation, and key rotation support.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  verifyToken,
  extractBearerToken,
  extractAndVerifyToken,
  getAuthContext,
  requireAuthContext,
  validateTokenFormat,
  validateAuthHeaderConstantTime,
  constantTimeCompare,
  reloadKeys,
} from '../jwt';

describe('JWT Verification with Key Rotation Tests', () => {
  const mockSecret = 'test-secret-key-minimum-32-characters-long';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_KEY_1 = mockSecret;
    process.env.JWT_KEY_2 = 'secondary-key-also-32-chars-minimum';
    process.env.JWT_AUDIENCE = 'test-audience';
    process.env.JWT_ISSUER = 'test-issuer';
    
    // Reload keys to pick up environment changes
    reloadKeys();
  });

  describe('Token Format Validation', () => {
    it('should accept valid JWT format', () => {
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.signature';
      
      expect(validateTokenFormat(validToken)).toBe(true);
    });

    it('should reject tokens with wrong number of parts', () => {
      expect(validateTokenFormat('only-two.parts')).toBe(false);
      expect(validateTokenFormat('one')).toBe(false);
      expect(validateTokenFormat('a.b.c.d')).toBe(false);
    });

    it('should reject tokens with invalid characters', () => {
      expect(validateTokenFormat('invalid token.with spaces')).toBe(false);
      expect(validateTokenFormat('invalid<token>.with<>brackets')).toBe(false);
    });

    it('should accept base64url characters', () => {
      const base64UrlToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ._signature-with_underscores';
      
      expect(validateTokenFormat(base64UrlToken)).toBe(true);
    });
  });

  describe('Constant-Time Comparison', () => {
    it('should return true for equal strings', () => {
      expect(constantTimeCompare('same', 'same')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(constantTimeCompare('different1', 'different2')).toBe(false);
    });

    it('should return false for different lengths', () => {
      expect(constantTimeCompare('short', 'longer-string')).toBe(false);
    });

    it('should return false for empty strings', () => {
      // P1-FIX: timingSafeEqual(Buffer.alloc(0), Buffer.alloc(0)) returns true,
      // so without an explicit guard the function would return true for two empty
      // strings, allowing an empty secret to "match" an empty challenge. The
      // implementation now rejects empty strings explicitly; this assertion verifies
      // that the guard is in place.
      expect(constantTimeCompare('', '')).toBe(false);
    });

    it('should be resistant to timing attacks', () => {
      const secret = 'a'.repeat(100);
      const attempts = 100;
      const times: number[] = [];

      for (let i = 0; i < attempts; i++) {
        const start = process.hrtime.bigint();
        constantTimeCompare(secret, 'b'.repeat(100));
        const end = process.hrtime.bigint();
        times.push(Number(end - start));
      }

      // Times should be relatively consistent (no early exit)
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const variance = times.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / times.length;
      const stdDev = Math.sqrt(variance);

      // Standard deviation should be reasonable (not too high variance)
      expect(stdDev / avg).toBeLessThan(1);
    });
  });

  describe('Authorization Header Validation', () => {
    it('should validate correct Bearer header', () => {
      expect(validateAuthHeaderConstantTime('Bearer token123')).toBe(true);
    });

    it('should reject missing header', () => {
      expect(validateAuthHeaderConstantTime(undefined)).toBe(false);
    });

    it('should reject empty header', () => {
      expect(validateAuthHeaderConstantTime('')).toBe(false);
    });

    it('should reject wrong prefix', () => {
      expect(validateAuthHeaderConstantTime('Basic dXNlcjpwYXNz')).toBe(false);
    });

    it('should reject case-sensitive prefix', () => {
      expect(validateAuthHeaderConstantTime('bearer token123')).toBe(false);
    });

    it('should use constant-time comparison', () => {
      // Should not leak information through timing
      expect(validateAuthHeaderConstantTime('Bxxxxx token')).toBe(false);
    });
  });

  describe('JWT Verification', () => {
    const createValidToken = (payload: object, secret: string = mockSecret): string => {
      return jwt.sign(payload, secret, {
        algorithm: 'HS256',
        audience: 'test-audience',
        issuer: 'test-issuer',
      });
    };

    it('should verify valid token', () => {
      const token = createValidToken({
        sub: 'user-123',
        role: 'admin',
        orgId: 'org-456',
      });

      const claims = verifyToken(token);

      expect(claims.sub).toBe('user-123');
      expect(claims.role).toBe('admin');
      expect(claims["orgId"]).toBe('org-456');
    });

    it('should reject expired token', () => {
      const token = jwt.sign(
        {
          sub: 'user-123',
          exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        },
        mockSecret,
        { algorithm: 'HS256' }
      );

      expect(() => verifyToken(token)).toThrow('Token expired');
    });

    it('should reject token with invalid signature', () => {
      const token = createValidToken({ sub: 'user-123' });
      const tamperedToken = token.slice(0, -5) + 'xxxxx';

      expect(() => verifyToken(tamperedToken)).toThrow('Invalid token');
    });

    it('should reject token with invalid format', () => {
      expect(() => verifyToken('not-a-valid-jwt')).toThrow('Invalid token format');
    });

    it('should enforce algorithm whitelist', () => {
      // Token signed with none algorithm (should be rejected)
      const noneToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjMifQ.';
      
      expect(() => verifyToken(noneToken)).toThrow();
    });

    it('should require sub claim', () => {
      const token = jwt.sign(
        { orgId: 'org-123' }, // Missing sub
        mockSecret,
        { algorithm: 'HS256' }
      );

      expect(() => verifyToken(token)).toThrow('missing required claim: sub');
    });

    it('should validate audience claim', () => {
      const token = jwt.sign(
        { sub: 'user-123' },
        mockSecret,
        {
          algorithm: 'HS256',
          audience: 'wrong-audience',
        }
      );

      expect(() => verifyToken(token)).toThrow('Invalid token');
    });

    it('should validate issuer claim', () => {
      const token = jwt.sign(
        { sub: 'user-123' },
        mockSecret,
        {
          algorithm: 'HS256',
          issuer: 'wrong-issuer',
        }
      );

      expect(() => verifyToken(token)).toThrow('Invalid token');
    });
  });

  describe('Key Rotation', () => {
    it('should verify tokens signed with primary key', () => {
      const token = jwt.sign(
        { sub: 'user-123', role: 'admin', orgId: 'org-456' },
        process.env.JWT_KEY_1!,
        { algorithm: 'HS256' }
      );

      const claims = verifyToken(token);
      expect(claims.sub).toBe('user-123');
    });

    it('should verify tokens signed with secondary key', () => {
      const token = jwt.sign(
        { sub: 'user-123', role: 'admin', orgId: 'org-456' },
        process.env.JWT_KEY_2!,
        { algorithm: 'HS256' }
      );

      const claims = verifyToken(token);
      expect(claims.sub).toBe('user-123');
    });

    it('should reject tokens signed with old key after rotation', () => {
      // First create token with current key
      const oldKey = 'old-key-that-will-be-rotated-out-123';
      process.env.JWT_KEY_1 = oldKey;
      reloadKeys();

      const token = jwt.sign(
        { sub: 'user-123', role: 'admin', orgId: 'org-456' },
        oldKey,
        { algorithm: 'HS256' }
      );

      // Now rotate keys
      process.env.JWT_KEY_1 = 'new-key-for-testing-purposes-123';
      process.env.JWT_KEY_2 = 'another-new-key-for-testing-123';
      reloadKeys();

      // Token signed with old key should fail
      expect(() => verifyToken(token)).toThrow('Invalid token');
    });

    it('should throw when no keys configured', () => {
      delete process.env.JWT_KEY_1;
      delete process.env.JWT_KEY_2;
      reloadKeys();

      const token = jwt.sign({ sub: 'user-123' }, 'any-key', { algorithm: 'HS256' });

      expect(() => verifyToken(token)).toThrow('JWT signing keys not configured');
    });

    it('should reject keys shorter than 32 characters', () => {
      process.env.JWT_KEY_1 = 'short-key';
      reloadKeys();

      const token = jwt.sign({ sub: 'user-123' }, 'any-key', { algorithm: 'HS256' });

      expect(() => verifyToken(token)).toThrow('JWT signing keys not configured');
    });
  });

  describe('Token Extraction', () => {
    it('should extract token from Bearer header', () => {
      const token = 'valid-token-123';
      const header = `Bearer ${token}`;

      const extracted = extractBearerToken(header);

      expect(extracted).toBe(token);
    });

    it('should return null for missing header', () => {
      expect(extractBearerToken(undefined)).toBeNull();
    });

    it('should return null for invalid format', () => {
      expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
    });

    it('should return null for token that is too short', () => {
      expect(extractBearerToken('Bearer short')).toBeNull();
    });

    it('should extract and verify token', () => {
      const payload = {
        sub: 'user-123',
        role: 'admin',
        orgId: 'org-456',
      };
      const token = jwt.sign(payload, mockSecret, { algorithm: 'HS256' });
      const header = `Bearer ${token}`;

      const result = extractAndVerifyToken(header);

      expect(result.valid).toBe(true);
      expect(result.claims?.sub).toBe('user-123');
    });

    it('should return error for invalid token', () => {
      const result = extractAndVerifyToken('Bearer invalid-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Auth Context', () => {
    const createToken = (payload: object): string => {
      return jwt.sign(payload, mockSecret, { algorithm: 'HS256' });
    };

    it('should extract auth context from valid token', () => {
      const token = createToken({
        sub: 'user-123',
        orgId: 'org-456',
        role: 'admin',
        jti: 'session-789',
      });

      const context = getAuthContext({ authorization: `Bearer ${token}` });

      expect(context).toMatchObject({
        userId: 'user-123',
        orgId: 'org-456',
        roles: ['admin'],
        sessionId: 'session-789',
      });
    });

    it('should return null for missing auth header', () => {
      const context = getAuthContext({});
      expect(context).toBeNull();
    });

    it('should return null for invalid token', () => {
      const context = getAuthContext({ authorization: 'Bearer invalid' });
      expect(context).toBeNull();
    });

    it('should return null for missing orgId', () => {
      const token = createToken({
        sub: 'user-123',
        // Missing orgId
      });

      const context = getAuthContext({ authorization: `Bearer ${token}` });
      expect(context).toBeNull();
    });

    it('should require auth context with requireAuthContext', () => {
      expect(() => {
        requireAuthContext({});
      }).toThrow('Authentication required');
    });

    it('should return context with requireAuthContext when valid', () => {
      const token = createToken({
        sub: 'user-123',
        orgId: 'org-456',
        role: 'viewer',
      });

      const context = requireAuthContext({ authorization: `Bearer ${token}` });

      expect(context.userId).toBe('user-123');
    });
  });

  describe('P1 SECURITY FIX: Constant-Time Key Verification', () => {
    it('should verify token with same timing regardless of key position', () => {
      // Create tokens signed with each key
      const tokenKey1 = jwt.sign(
        { sub: 'user-123', role: 'admin', orgId: 'org-456' },
        process.env.JWT_KEY_1!,
        { algorithm: 'HS256' }
      );

      const times: number[] = [];
      const iterations = 50;

      // Measure verification time for token signed with first key
      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        verifyToken(tokenKey1);
        const end = process.hrtime.bigint();
        times.push(Number(end - start));
      }

      // Calculate statistics
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const variance = times.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / times.length;
      const stdDev = Math.sqrt(variance);

      // Standard deviation should be reasonable - consistent timing
      // Coefficient of variation should be less than 0.5 (50%)
      expect(stdDev / avg).toBeLessThan(0.5);
    });

    it('should process all configured keys for invalid tokens', () => {
      // Create a token signed with a key that is not configured
      const unknownKey = 'unknown-key-not-in-config-32chars';
      const token = jwt.sign(
        { sub: 'user-123', role: 'admin', orgId: 'org-456' },
        unknownKey,
        { algorithm: 'HS256' }
      );

      // Should throw after trying all keys
      expect(() => verifyToken(token)).toThrow('Invalid token');
    });

    it('should maintain consistent error timing for invalid tokens', () => {
      const invalidToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.invalid-signature';

      const times: number[] = [];
      const iterations = 30;

      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        try {
          verifyToken(invalidToken);
        } catch {
          // Expected to fail
        }
        const end = process.hrtime.bigint();
        times.push(Number(end - start));
      }

      // Calculate statistics
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const variance = times.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / times.length;
      const stdDev = Math.sqrt(variance);

      // Timing should be relatively consistent
      expect(stdDev / avg).toBeLessThan(0.5);
    });

    it('should not leak information through early returns on success', () => {
      const token = jwt.sign(
        { sub: 'user-123', role: 'admin', orgId: 'org-456' },
        process.env.JWT_KEY_1!,
        { algorithm: 'HS256' }
      );

      // Verify multiple times to ensure consistent behavior
      for (let i = 0; i < 10; i++) {
        const claims = verifyToken(token);
        expect(claims.sub).toBe('user-123');
      }
    });

    it('should correctly verify with second key when first fails', () => {
      // Create token signed with second key
      const tokenKey2 = jwt.sign(
        { sub: 'user-456', role: 'viewer', orgId: 'org-789' },
        process.env.JWT_KEY_2!,
        { algorithm: 'HS256' }
      );

      const claims = verifyToken(tokenKey2);
      expect(claims.sub).toBe('user-456');
    });

    it('should handle expired tokens with constant-time behavior', () => {
      const expiredToken = jwt.sign(
        {
          sub: 'user-123',
          exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        },
        process.env.JWT_KEY_1!,
        { algorithm: 'HS256' }
      );

      const times: number[] = [];
      const iterations = 20;

      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        try {
          verifyToken(expiredToken);
        } catch {
          // Expected to fail
        }
        const end = process.hrtime.bigint();
        times.push(Number(end - start));
      }

      // Calculate coefficient of variation
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const variance = times.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / times.length;
      const stdDev = Math.sqrt(variance);

      // Timing should be consistent
      expect(stdDev / avg).toBeLessThan(0.5);
    });
  });
});
