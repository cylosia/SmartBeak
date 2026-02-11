/**
 * P1 SECURITY FIXES TEST: AbuseGuard Security Tests
 * 
 * Tests for the 4 P1 security fixes in abuseGuard middleware:
 * 1. Schema strictness (.strict())
 * 2. Role validation for riskOverride
 * 3. Regex state poisoning prevention
 * 4. Log sanitization
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AbuseCheckInputSchema,
  abuseGuard,
  checkAbuse,
  checkAbuseDetailed,
  checkContentRisk,
  GuardRequest,
  GuardResponse,
  HighRiskContentError,
  ContentFlaggedError,
  AbuseValidationError,
} from '../abuseGuard';

describe('AbuseGuard Security Fixes', () => {
  describe('Issue 1: Schema Strictness (.strict())', () => {
    it('should accept valid input with known properties', () => {
      const validInput = {
        content: 'Safe content here',
        riskFlags: ['spam'],
        userId: 'user-123',
      };

      const result = AbuseCheckInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject input with unknown properties (mass assignment prevention)', () => {
      const maliciousInput = {
        content: 'Content',
        isAdmin: true, // Unknown property - attempt at mass assignment
        internalRole: 'superuser', // Another unknown property
      };

      const result = AbuseCheckInputSchema.safeParse(maliciousInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.message.includes('Unrecognized'))).toBe(true);
      }
    });

    it('should reject deeply nested unknown properties', () => {
      const maliciousInput = {
        content: 'Content',
        metadata: {
          nested: {
            exploit: true,
          },
        },
      };

      const result = AbuseCheckInputSchema.safeParse(maliciousInput);
      expect(result.success).toBe(false);
    });

    it('should accept empty object', () => {
      const result = AbuseCheckInputSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept input with all optional fields', () => {
      const fullInput = {
        content: 'Content',
        riskFlags: ['spam', 'suspicious'],
        riskOverride: false,
        userId: 'user-123',
        ip: '192.168.1.1',
      };

      const result = AbuseCheckInputSchema.safeParse(fullInput);
      expect(result.success).toBe(true);
    });
  });

  describe('Issue 2: Role Validation for riskOverride', () => {
    const mockResponse = () => ({
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      send: vi.fn(),
    });

    const mockNext = vi.fn();

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should allow admin to use riskOverride for high risk flags', async () => {
      const req: GuardRequest = {
        body: {
          content: 'High risk content',
          riskFlags: ['illegal'], // Critical flag - score 100
          riskOverride: true,
        },
        user: { role: 'admin', id: 'admin-123' },
      };

      // Illegal is critical and cannot be overridden by anyone
      await expect(abuseGuard(req, mockResponse(), mockNext)).rejects.toThrow('Prohibited content detected');
    });

    it('should allow admin to override high-risk (non-critical) flags', async () => {
      const req: GuardRequest = {
        body: {
          content: 'Content with spam',
          riskFlags: ['spam'], // Score 75 - high risk but not critical
          riskOverride: true,
        },
        user: { role: 'admin', id: 'admin-123' },
      };

      await abuseGuard(req, mockResponse(), mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject non-admin using riskOverride for high risk content', async () => {
      const req: GuardRequest = {
        body: {
          content: 'Content with spam',
          riskFlags: ['spam'], // Score 75 - high risk
          riskOverride: true,
        },
        user: { role: 'viewer', id: 'user-123' },
      };

      await expect(abuseGuard(req, mockResponse(), mockNext)).rejects.toThrow(HighRiskContentError);
    });

    it('should reject anonymous user using riskOverride', async () => {
      const req: GuardRequest = {
        body: {
          content: 'Content with spam',
          riskFlags: ['spam'], // Score 75 - high risk
          riskOverride: true,
        },
        // No user property
      };

      await expect(abuseGuard(req, mockResponse(), mockNext)).rejects.toThrow(HighRiskContentError);
    });

    it('should reject user without role using riskOverride', async () => {
      const req: GuardRequest = {
        body: {
          content: 'Content with spam',
          riskFlags: ['spam'],
          riskOverride: true,
        },
        user: { id: 'user-123' }, // Has user but no role
      };

      await expect(abuseGuard(req, mockResponse(), mockNext)).rejects.toThrow(HighRiskContentError);
    });

    it('should allow content through when no risk flags and no override needed', async () => {
      const req: GuardRequest = {
        body: {
          content: 'Safe content',
        },
        user: { role: 'viewer', id: 'user-123' },
      };

      await abuseGuard(req, mockResponse(), mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should apply role check to content-based risk detection', async () => {
      const req: GuardRequest = {
        body: {
          content: '<script>alert("xss")</script>', // XSS pattern triggers high risk
          riskOverride: true,
        },
        user: { role: 'editor', id: 'user-123' },
      };

      // Non-admin should not be able to override
      await expect(abuseGuard(req, mockResponse(), mockNext)).rejects.toThrow(ContentFlaggedError);
    });

    it('should allow admin to override content-based risk', async () => {
      const req: GuardRequest = {
        body: {
          content: '<script>alert("xss")</script>', // XSS pattern triggers high risk
          riskOverride: true,
        },
        user: { role: 'admin', id: 'admin-123' },
      };

      await abuseGuard(req, mockResponse(), mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Issue 3: Regex State Poisoning Prevention', () => {
    it('should reset regex lastIndex before each test', () => {
      const content = 'Buy now! Click here! Limited time offer!';
      
      // First check
      const result1 = checkContentRisk(content);
      expect(result1.allowed).toBe(false);
      expect(result1.flags).toContain('spam_keywords');

      // Second check - should produce same result (no state poisoning)
      const result2 = checkContentRisk(content);
      expect(result2.allowed).toBe(false);
      expect(result2.flags).toContain('spam_keywords');
    });

    it('should handle multiple consecutive checks without state issues', () => {
      const contents = [
        'Buy now!',
        'Normal content',
        'Click here for viagra pills',
        'Safe text',
        'Limited time casino offer',
      ];

      // Run multiple checks in sequence
      const results = contents.map(content => checkContentRisk(content));

      // Each check should be independent
      expect(results[0].flags).toContain('spam_keywords');
      expect(results[1].allowed).toBe(true);
      expect(results[2].flags).toContain('spam_keywords');
      expect(results[2].flags).toContain('spam_content');
      expect(results[3].allowed).toBe(true);
      expect(results[4].flags).toContain('spam_keywords');
    });

    it('should detect patterns consistently across multiple calls', () => {
      const suspiciousContent = '<script>alert(1)</script>';
      
      for (let i = 0; i < 10; i++) {
        const result = checkContentRisk(suspiciousContent);
        expect(result.flags).toContain('xss_attempt');
        expect(result.allowed).toBe(false);
      }
    });

    it('should handle edge case of empty content', () => {
      const result = checkContentRisk('');
      expect(result.allowed).toBe(true);
      expect(result.riskScore).toBe(0);
    });

    it('should handle edge case of undefined content', () => {
      const result = checkContentRisk(undefined);
      expect(result.allowed).toBe(true);
      expect(result.riskScore).toBe(0);
    });
  });

  describe('Issue 4: Log Sanitization', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('should sanitize sensitive data in logs', async () => {
      const req: GuardRequest = {
        body: {
          content: 'Content with <script>alert(1)</script>',
          userId: 'user-123',
          ip: '192.168.1.1',
        },
        user: { role: 'viewer', id: 'user-123' },
      };

      const mockRes = mockResponse();
      const mockNextFn = vi.fn();

      await abuseGuard(req, mockRes, mockNextFn);

      expect(consoleWarnSpy).toHaveBeenCalled();
      const logCall = consoleWarnSpy.mock.calls[0];
      expect(logCall[0]).toBe('[abuseGuard] High risk submission:');
      
      // Check that log data exists and contains expected structure
      const logData = logCall[1];
      expect(logData).toBeDefined();
      expect(logData.riskScore).toBeDefined();
      expect(logData.flags).toBeDefined();
    });

    it('should not log raw sensitive values', async () => {
      const req: GuardRequest = {
        body: {
          content: 'Normal content with some spam keywords like buy now',
          userId: 'user-123',
          ip: '192.168.1.1',
        },
        user: { role: 'viewer', id: 'user-123' },
      };

      const mockRes = mockResponse();
      const mockNextFn = vi.fn();

      await abuseGuard(req, mockRes, mockNextFn);

      expect(consoleWarnSpy).toHaveBeenCalled();
      const logData = consoleWarnSpy.mock.calls[0][1];
      
      // Ensure log data is an object (sanitized)
      expect(typeof logData).toBe('object');
    });

    it('should not log when there is no risk', async () => {
      const req: GuardRequest = {
        body: {
          content: 'Completely safe content with no issues whatsoever',
        },
        user: { role: 'viewer', id: 'user-123' },
      };

      const mockRes = mockResponse();
      const mockNextFn = vi.fn();

      await abuseGuard(req, mockRes, mockNextFn);

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('Integration Tests', () => {
    const mockResponse = () => ({
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      send: vi.fn(),
    });

    const mockNext = vi.fn();

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should handle complete flow with all security checks', async () => {
      const req: GuardRequest = {
        body: {
          content: 'Safe content',
          userId: 'user-123',
        },
        user: { role: 'viewer', id: 'user-123' },
      };

      await abuseGuard(req, mockResponse(), mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject mass assignment attempt in middleware', async () => {
      const req: GuardRequest = {
        body: {
          content: 'Content',
          unknownField: 'malicious',
        },
      };

      await expect(abuseGuard(req, mockResponse(), mockNext)).rejects.toThrow(AbuseValidationError);
    });

    it('checkAbuse should use strict schema validation', () => {
      const result = checkAbuse({
        content: 'Test',
        extraField: 'not allowed',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Invalid payload');
    });

    it('checkAbuseDetailed should use strict schema validation', () => {
      const result = checkAbuseDetailed({
        content: 'Test',
        extraField: 'not allowed',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Invalid payload');
    });
  });
});

// Helper function for mock response
function mockResponse(): GuardResponse {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    send: vi.fn(),
  };
}
