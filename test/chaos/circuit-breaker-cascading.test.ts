/**
 * Chaos/Failure Tests: Circuit Breaker Cascading Failures
 *
 * Tests circuit breaker behavior under fault injection:
 * - Failure threshold triggering
 * - State transitions (CLOSED → OPEN → HALF_OPEN → CLOSED)
 * - Cascading failures across independent circuit breakers
 * - Rapid state toggling at threshold boundary
 * - 4xx error exclusion from failure count
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

import { CircuitBreaker, CircuitState } from '@kernel/retry';

describe('Circuit Breaker - Cascading Failure Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Failure Threshold Triggering', () => {
    it('should open circuit after exactly failureThreshold failures', async () => {
      const breaker = new CircuitBreaker('threshold-test', {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        halfOpenMaxCalls: 3,
      });

      // 4 failures should keep circuit closed
      for (let i = 0; i < 4; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('service-failure');
          });
        } catch {
          // Expected
        }
      }

      expect(await breaker.getState()).toBe(CircuitState.CLOSED);

      // 5th failure should open the circuit
      try {
        await breaker.execute(async () => {
          throw new Error('service-failure');
        });
      } catch {
        // Expected
      }

      expect(await breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should reject requests immediately when circuit is open', async () => {
      const breaker = new CircuitBreaker('reject-test', {
        failureThreshold: 2,
        resetTimeoutMs: 60000,
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

      // Requests should be rejected with clear error
      await expect(
        breaker.execute(async () => 'should-not-run')
      ).rejects.toThrow('Circuit breaker open');
    });
  });

  describe('State Transition: OPEN → HALF_OPEN → CLOSED', () => {
    it('should transition to HALF_OPEN after reset timeout expires', async () => {
      const breaker = new CircuitBreaker('halfopen-test', {
        failureThreshold: 2,
        resetTimeoutMs: 50, // Short timeout for testing
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

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 60));

      // Next successful call should transition through HALF_OPEN to CLOSED
      const result = await breaker.execute(async () => 'recovered');

      expect(result).toBe('recovered');
      expect(await breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should re-open circuit if probe call fails in HALF_OPEN state', async () => {
      const breaker = new CircuitBreaker('reopen-test', {
        failureThreshold: 2,
        resetTimeoutMs: 50,
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

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 60));

      // Probe call fails — should re-open
      try {
        await breaker.execute(async () => {
          throw new Error('still-failing');
        });
      } catch {
        // Expected
      }

      expect(await breaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('Cascading Circuit Breakers', () => {
    it('should open circuits independently when one feeds errors to another', async () => {
      const circuitA = new CircuitBreaker('service-a', {
        failureThreshold: 3,
        resetTimeoutMs: 60000,
        halfOpenMaxCalls: 1,
      });

      const circuitB = new CircuitBreaker('service-b', {
        failureThreshold: 3,
        resetTimeoutMs: 60000,
        halfOpenMaxCalls: 1,
      });

      // Circuit A fails, causing Circuit B to receive errors
      for (let i = 0; i < 3; i++) {
        try {
          await circuitA.execute(async () => {
            throw new Error('service-a-down');
          });
        } catch (error) {
          // Circuit A failure cascades to Circuit B
          try {
            await circuitB.execute(async () => {
              throw error;
            });
          } catch {
            // Expected
          }
        }
      }

      // Both circuits should be open independently
      expect(await circuitA.getState()).toBe(CircuitState.OPEN);
      expect(await circuitB.getState()).toBe(CircuitState.OPEN);
    });

    it('should allow Circuit B to remain closed while Circuit A is open', async () => {
      const circuitA = new CircuitBreaker('isolated-a', {
        failureThreshold: 2,
        resetTimeoutMs: 60000,
        halfOpenMaxCalls: 1,
      });

      const circuitB = new CircuitBreaker('isolated-b', {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        halfOpenMaxCalls: 1,
      });

      // Open circuit A
      for (let i = 0; i < 2; i++) {
        try {
          await circuitA.execute(async () => {
            throw new Error('failure');
          });
        } catch {
          // Expected
        }
      }

      expect(await circuitA.getState()).toBe(CircuitState.OPEN);
      expect(await circuitB.getState()).toBe(CircuitState.CLOSED);

      // Circuit B should still work fine
      const result = await circuitB.execute(async () => 'b-is-fine');
      expect(result).toBe('b-is-fine');
    });
  });

  describe('Rapid State Toggling', () => {
    it('should handle alternating success/failure at threshold boundary stably', async () => {
      const breaker = new CircuitBreaker('rapid-toggle', {
        failureThreshold: 3,
        resetTimeoutMs: 60000,
        halfOpenMaxCalls: 1,
      });

      // Alternate: 2 failures, 1 success (resets counter), 2 failures, 1 success...
      for (let round = 0; round < 5; round++) {
        // 2 failures
        for (let i = 0; i < 2; i++) {
          try {
            await breaker.execute(async () => {
              throw new Error('failure');
            });
          } catch {
            // Expected
          }
        }

        // 1 success (resets failure counter)
        await breaker.execute(async () => 'success');
      }

      // Circuit should remain closed — never hit threshold
      expect(await breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('4xx Error Exclusion', () => {
    it('should not count 4xx client errors toward failure threshold', async () => {
      const breaker = new CircuitBreaker('4xx-test', {
        failureThreshold: 3,
        resetTimeoutMs: 60000,
        halfOpenMaxCalls: 1,
      });

      // Send 10 "not found" errors — should NOT open circuit
      for (let i = 0; i < 10; i++) {
        try {
          await breaker.execute(async () => {
            const err = new Error('not found') as Error & { statusCode: number };
            err.statusCode = 404;
            throw err;
          });
        } catch {
          // Expected
        }
      }

      // Circuit should still be closed — 4xx errors are excluded
      expect(await breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });
});
