/**
 * Performance Benchmark: Retry & Circuit Breaker
 *
 * Measures overhead of withRetry() and CircuitBreaker.execute() on the
 * happy path, and state transition latency.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { withRetry, CircuitBreaker, CircuitState } from '@kernel/retry';

describe('Retry & Circuit Breaker Benchmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('withRetry() Success Path', () => {
    it('should complete 1000 calls with < 0.5ms avg overhead on success path', async () => {
      const ITERATIONS = 1000;
      const MAX_AVG_MS = 0.5;

      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        await withRetry(async () => i, { maxRetries: 3 });
      }

      const elapsed = performance.now() - start;
      const avgMs = elapsed / ITERATIONS;

      expect(avgMs).toBeLessThan(MAX_AVG_MS);
    });

    it('should return correct results through retry wrapper', async () => {
      const result = await withRetry(async () => 42, { maxRetries: 3 });
      expect(result).toBe(42);
    });
  });

  describe('CircuitBreaker.execute() in CLOSED State', () => {
    it('should complete 1000 calls with < 0.5ms avg overhead in CLOSED state', async () => {
      const breaker = new CircuitBreaker('bench-closed', {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        halfOpenMaxCalls: 3,
      });

      const ITERATIONS = 1000;
      const MAX_AVG_MS = 0.5;

      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        await breaker.execute(async () => i);
      }

      const elapsed = performance.now() - start;
      const avgMs = elapsed / ITERATIONS;

      expect(avgMs).toBeLessThan(MAX_AVG_MS);
    });
  });

  describe('Circuit Breaker State Transition Latency', () => {
    it('should complete full state cycle (CLOSED → OPEN → HALF_OPEN → CLOSED) in < 100ms', async () => {
      const breaker = new CircuitBreaker('bench-cycle', {
        failureThreshold: 3,
        resetTimeoutMs: 10, // Very short for benchmarking
        halfOpenMaxCalls: 1,
      });

      const start = performance.now();

      // CLOSED state — verify
      expect(await breaker.getState()).toBe(CircuitState.CLOSED);

      // Trigger 3 failures to open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('service-failure');
          });
        } catch {
          // Expected
        }
      }

      // Should be OPEN
      expect(await breaker.getState()).toBe(CircuitState.OPEN);

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 20));

      // Execute a successful call — should transition to HALF_OPEN then CLOSED
      await breaker.execute(async () => 'success');

      // Should be CLOSED again
      expect(await breaker.getState()).toBe(CircuitState.CLOSED);

      const elapsed = performance.now() - start;

      // Subtract the 20ms sleep for the real overhead
      expect(elapsed - 20).toBeLessThan(100);
    });

    it('should measure OPEN → rejection latency at < 1ms', async () => {
      const breaker = new CircuitBreaker('bench-reject', {
        failureThreshold: 2,
        resetTimeoutMs: 60000, // Long reset so it stays open
        halfOpenMaxCalls: 1,
      });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('failure');
          });
        } catch {
          // Expected
        }
      }

      expect(await breaker.getState()).toBe(CircuitState.OPEN);

      // Measure rejection latency
      const ITERATIONS = 100;
      const start = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        try {
          await breaker.execute(async () => 'should-not-execute');
        } catch {
          // Expected — circuit is open
        }
      }

      const elapsed = performance.now() - start;
      const avgMs = elapsed / ITERATIONS;

      expect(avgMs).toBeLessThan(1);
    });
  });
});
