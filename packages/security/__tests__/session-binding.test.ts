/**
 * P2 TEST: Session Binding Tests
 * 
 * Tests session binding to prevent token theft and replay attacks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';

describe('Session Binding Tests', () => {
  // Simulated session binding implementation for testing
  interface SessionBinding {
    sessionId: string;
    userAgent: string;
    ipAddress: string;
    fingerprint: string;
    createdAt: number;
  }

  const generateFingerprint = (userAgent: string, ip: string): string => {
    const data = `${userAgent}:${ip}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  };

  const createSessionBinding = (
    sessionId: string,
    userAgent: string,
    ipAddress: string
  ): SessionBinding => ({
    sessionId,
    userAgent,
    ipAddress,
    fingerprint: generateFingerprint(userAgent, ipAddress),
    createdAt: Date.now(),
  });

  const validateSessionBinding = (
    binding: SessionBinding,
    userAgent: string,
    ipAddress: string,
    options: { strictIpMatch?: boolean; allowIpSubnet?: boolean } = {}
  ): { valid: boolean; reason?: string } => {
    const currentFingerprint = generateFingerprint(userAgent, ipAddress);
    
    // Check if fingerprints match exactly
    if (binding.fingerprint === currentFingerprint) {
      return { valid: true };
    }

    // If strict matching, reject any mismatch
    if (options.strictIpMatch) {
      return { valid: false, reason: 'Session binding mismatch' };
    }

    // Check user agent similarity (allow minor version changes)
    const uaMatch = binding.userAgent.split('/')[0] === userAgent.split('/')[0];
    
    if (!uaMatch) {
      return { valid: false, reason: 'User agent mismatch' };
    }

    // Allow IP changes within same subnet if configured
    if (options.allowIpSubnet) {
      const originalSubnet = binding.ipAddress.split('.').slice(0, 3).join('.');
      const currentSubnet = ipAddress.split('.').slice(0, 3).join('.');
      
      if (originalSubnet === currentSubnet) {
        return { valid: true };
      }
    }

    return { valid: false, reason: 'IP address mismatch' };
  };

  describe('Session Binding Creation', () => {
    it('should create session binding with fingerprint', () => {
      const binding = createSessionBinding(
        'sess-123',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        '192.168.1.100'
      );

      expect(binding.sessionId).toBe('sess-123');
      expect(binding.userAgent).toContain('Mozilla/5.0');
      expect(binding.ipAddress).toBe('192.168.1.100');
      expect(binding.fingerprint).toHaveLength(64); // SHA-256 hex
      expect(binding.createdAt).toBeGreaterThan(0);
    });

    it('should generate consistent fingerprints for same inputs', () => {
      const userAgent = 'Mozilla/5.0';
      const ip = '192.168.1.100';

      const fp1 = generateFingerprint(userAgent, ip);
      const fp2 = generateFingerprint(userAgent, ip);

      expect(fp1).toBe(fp2);
    });

    it('should generate different fingerprints for different inputs', () => {
      const fp1 = generateFingerprint('Mozilla/5.0', '192.168.1.100');
      const fp2 = generateFingerprint('Chrome/91.0', '192.168.1.100');
      const fp3 = generateFingerprint('Mozilla/5.0', '192.168.1.101');

      expect(fp1).not.toBe(fp2);
      expect(fp1).not.toBe(fp3);
      expect(fp2).not.toBe(fp3);
    });
  });

  describe('Session Binding Validation', () => {
    it('should validate matching session', () => {
      const binding = createSessionBinding(
        'sess-123',
        'Mozilla/5.0 (Windows NT 10.0)',
        '192.168.1.100'
      );

      const result = validateSessionBinding(
        binding,
        'Mozilla/5.0 (Windows NT 10.0)',
        '192.168.1.100'
      );

      expect(result.valid).toBe(true);
    });

    it('should reject mismatched user agent', () => {
      const binding = createSessionBinding(
        'sess-123',
        'Mozilla/5.0 (Windows NT 10.0)',
        '192.168.1.100'
      );

      const result = validateSessionBinding(
        binding,
        'Chrome/91.0 (Windows NT 10.0)',
        '192.168.1.100'
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Session binding mismatch');
    });

    it('should reject mismatched IP in strict mode', () => {
      const binding = createSessionBinding(
        'sess-123',
        'Mozilla/5.0 (Windows NT 10.0)',
        '192.168.1.100'
      );

      const result = validateSessionBinding(
        binding,
        'Mozilla/5.0 (Windows NT 10.0)',
        '192.168.1.101',
        { strictIpMatch: true }
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Session binding mismatch');
    });

    it('should allow IP changes within same subnet', () => {
      const binding = createSessionBinding(
        'sess-123',
        'Mozilla/5.0 (Windows NT 10.0)',
        '192.168.1.100'
      );

      const result = validateSessionBinding(
        binding,
        'Mozilla/5.0 (Windows NT 10.0)',
        '192.168.1.105',
        { allowIpSubnet: true }
      );

      expect(result.valid).toBe(true);
    });

    it('should reject IP from different subnet', () => {
      const binding = createSessionBinding(
        'sess-123',
        'Mozilla/5.0 (Windows NT 10.0)',
        '192.168.1.100'
      );

      const result = validateSessionBinding(
        binding,
        'Mozilla/5.0 (Windows NT 10.0)',
        '10.0.0.50',
        { allowIpSubnet: true }
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('IP address mismatch');
    });
  });

  describe('Token Binding to Session', () => {
    interface BoundToken {
      token: string;
      sessionBinding: SessionBinding;
      boundAt: number;
    }

    const bindTokenToSession = (
      token: string,
      userAgent: string,
      ipAddress: string
    ): BoundToken => ({
      token,
      sessionBinding: createSessionBinding(
        `sess-${Date.now()}`,
        userAgent,
        ipAddress
      ),
      boundAt: Date.now(),
    });

    const verifyBoundToken = (
      boundToken: BoundToken,
      userAgent: string,
      ipAddress: string
    ): boolean => {
      const result = validateSessionBinding(
        boundToken.sessionBinding,
        userAgent,
        ipAddress
      );
      return result.valid;
    };

    it('should bind token to session', () => {
      const token = 'jwt-token-123';
      const bound = bindTokenToSession(
        token,
        'Mozilla/5.0 (Windows NT 10.0)',
        '192.168.1.100'
      );

      expect(bound.token).toBe(token);
      expect(bound.sessionBinding).toBeDefined();
      expect(bound.boundAt).toBeGreaterThan(0);
    });

    it('should verify bound token with matching context', () => {
      const bound = bindTokenToSession(
        'jwt-token-123',
        'Mozilla/5.0 (Windows NT 10.0)',
        '192.168.1.100'
      );

      const isValid = verifyBoundToken(
        bound,
        'Mozilla/5.0 (Windows NT 10.0)',
        '192.168.1.100'
      );

      expect(isValid).toBe(true);
    });

    it('should reject bound token with stolen context', () => {
      const bound = bindTokenToSession(
        'jwt-token-123',
        'Mozilla/5.0 (Windows NT 10.0)',
        '192.168.1.100'
      );

      // Attacker tries to use token from different device/IP
      const isValid = verifyBoundToken(
        bound,
        'AttackerBot/1.0',
        '10.0.0.50'
      );

      expect(isValid).toBe(false);
    });
  });

  describe('Session Hijacking Detection', () => {
    interface SessionMonitor {
      bindings: SessionBinding[];
      suspiciousEvents: Array<{
        timestamp: number;
        reason: string;
        attemptedIp?: string;
        attemptedUserAgent?: string;
      }>;
    }

    const detectSuspiciousActivity = (
      monitor: SessionMonitor,
      currentBinding: SessionBinding,
      attempts: Array<{ userAgent: string; ip: string; time: number }>
    ): SessionMonitor => {
      const updated = { ...monitor };

      for (const attempt of attempts) {
        const validation = validateSessionBinding(
          currentBinding,
          attempt.userAgent,
          attempt.ip,
          { strictIpMatch: true }
        );

        if (!validation.valid) {
          updated.suspiciousEvents.push({
            timestamp: attempt.time,
            reason: validation.reason || 'Unknown mismatch',
            attemptedIp: attempt.ip,
            attemptedUserAgent: attempt.userAgent,
          });
        }
      }

      return updated;
    };

    it('should detect rapid location changes', () => {
      const binding = createSessionBinding(
        'sess-123',
        'Mozilla/5.0 (Windows NT 10.0)',
        '192.168.1.100'
      );

      const monitor: SessionMonitor = {
        bindings: [binding],
        suspiciousEvents: [],
      };

      const attempts = [
        { userAgent: 'Mozilla/5.0', ip: '10.0.0.1', time: Date.now() },
        { userAgent: 'Mozilla/5.0', ip: '172.16.0.1', time: Date.now() + 1000 },
      ];

      const updated = detectSuspiciousActivity(monitor, binding, attempts);

      expect(updated.suspiciousEvents).toHaveLength(2);
    });

    it('should detect user agent changes', () => {
      const binding = createSessionBinding(
        'sess-123',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        '192.168.1.100'
      );

      const monitor: SessionMonitor = {
        bindings: [binding],
        suspiciousEvents: [],
      };

      const attempts = [
        { userAgent: 'Chrome/91.0 (Windows NT 10.0)', ip: '192.168.1.100', time: Date.now() },
      ];

      const updated = detectSuspiciousActivity(monitor, binding, attempts);

      expect(updated.suspiciousEvents).toHaveLength(1);
      expect(updated.suspiciousEvents[0]!.reason).toBe('Session binding mismatch');
    });
  });
});
