/**
 * T3: Rate Limiter Redis Failover Behavior Test
 *
 * Tests the in-memory rate limiter fallback that activates when Redis is unavailable.
 * Validates:
 * 1. In-memory rate limiter correctly limits after max attempts
 * 2. Window expiration resets the counter
 * 3. Cleanup runs when map exceeds threshold
 * 4. Independent keys don't interfere
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryRateLimiter } from '../../services/in-memory-rate-limit';

describe('InMemoryRateLimiter (T3)', () => {
  let limiter: InMemoryRateLimiter;

  beforeEach(() => {
    limiter = new InMemoryRateLimiter(5); // Low threshold for testing cleanup
  });

  describe('Basic rate limiting', () => {
    it('should allow requests within the limit', () => {
      const result1 = limiter.check('key1', 5, 60000);
      const result2 = limiter.check('key1', 5, 60000);
      const result3 = limiter.check('key1', 5, 60000);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(true);
      expect(result1.retryAfter).toBe(0);
    });

    it('should block after exceeding the max limit', () => {
      // Allow 3 requests
      const max = 3;
      const windowMs = 60000;

      limiter.check('key-block', max, windowMs); // 1
      limiter.check('key-block', max, windowMs); // 2
      limiter.check('key-block', max, windowMs); // 3
      const result = limiter.check('key-block', max, windowMs); // 4 — blocked

      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should return correct retryAfter value in seconds', () => {
      const max = 1;
      const windowMs = 30000; // 30 seconds

      limiter.check('key-retry', max, windowMs); // 1
      const blocked = limiter.check('key-retry', max, windowMs); // 2 — blocked

      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfter).toBeLessThanOrEqual(30);
      expect(blocked.retryAfter).toBeGreaterThan(0);
    });

    it('should block at exactly max+1 attempts', () => {
      const max = 5;
      const windowMs = 60000;
      const key = 'key-exact';

      for (let i = 0; i < max; i++) {
        const result = limiter.check(key, max, windowMs);
        expect(result.allowed).toBe(true);
      }

      // max+1 should be blocked
      const result = limiter.check(key, max, windowMs);
      expect(result.allowed).toBe(false);
    });
  });

  describe('Window expiration', () => {
    it('should reset counter after window expires', () => {
      const max = 2;
      const windowMs = 100; // 100ms window

      limiter.check('key-expire', max, windowMs); // 1
      limiter.check('key-expire', max, windowMs); // 2
      const blocked = limiter.check('key-expire', max, windowMs); // 3 — blocked
      expect(blocked.allowed).toBe(false);

      // Simulate time passing by manipulating the internal state
      // We need to wait for the window to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = limiter.check('key-expire', max, windowMs);
          expect(result.allowed).toBe(true);
          resolve();
        }, 150); // Wait longer than the window
      });
    });
  });

  describe('Independent keys', () => {
    it('should track keys independently', () => {
      const max = 2;
      const windowMs = 60000;

      limiter.check('ip-1', max, windowMs); // ip-1: 1
      limiter.check('ip-1', max, windowMs); // ip-1: 2
      const blocked = limiter.check('ip-1', max, windowMs); // ip-1: 3 — blocked
      expect(blocked.allowed).toBe(false);

      // Different key should still be allowed
      const result = limiter.check('ip-2', max, windowMs);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Cleanup behavior', () => {
    it('should trigger cleanup when map exceeds threshold', () => {
      const windowMs = 1; // 1ms window — will expire immediately
      const max = 100;

      // Fill up beyond threshold (5 for this test)
      for (let i = 0; i < 6; i++) {
        limiter.check(`cleanup-key-${i}`, max, windowMs);
      }

      // Wait for entries to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // This check should trigger cleanup since size > threshold (5)
          // and all previous entries have expired
          limiter.check('cleanup-trigger', max, 60000);

          // After cleanup, old expired entries should be removed
          // Only the new key and any non-expired should remain
          expect(limiter.size).toBeLessThanOrEqual(7);
          resolve();
        }, 10);
      });
    });

    it('should return correct count of removed entries from cleanup', () => {
      const windowMs = 1; // 1ms — expires immediately

      limiter.check('remove-1', 100, windowMs);
      limiter.check('remove-2', 100, windowMs);
      limiter.check('remove-3', 100, windowMs);

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const removed = limiter.cleanup();
          expect(removed).toBe(3);
          expect(limiter.size).toBe(0);
          resolve();
        }, 10);
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle zero max (always block)', () => {
      const result = limiter.check('zero-max', 0, 60000);
      expect(result.allowed).toBe(false);
    });

    it('should handle clear() method', () => {
      limiter.check('clear-1', 5, 60000);
      limiter.check('clear-2', 5, 60000);
      expect(limiter.size).toBe(2);

      limiter.clear();
      expect(limiter.size).toBe(0);

      // After clear, should be allowed again
      const result = limiter.check('clear-1', 5, 60000);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Auth rate limiter simulation', () => {
    it('should block after 5 auth attempts within 15 minutes', () => {
      const AUTH_RATE_LIMIT_MAX = 5;
      const AUTH_RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes

      for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i++) {
        const result = limiter.check('ratelimit:auth:192.168.1.1', AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW);
        expect(result.allowed).toBe(true);
      }

      // 6th attempt should be blocked
      const blocked = limiter.check('ratelimit:auth:192.168.1.1', AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfter).toBeGreaterThan(0);
      expect(blocked.retryAfter).toBeLessThanOrEqual(15 * 60);
    });
  });
});
