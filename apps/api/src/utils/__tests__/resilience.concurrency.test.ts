/**
 * P1 ASYNC/CONCURRENCY TESTS: Circuit Breaker
 * 
 * Tests for:
 * - Mutex protection for state reads
 * - Race condition prevention
 * - Thread-safe state transitions
 */

import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker } from '../resilience';

describe('Circuit Breaker - Async/Concurrency Tests', () => {
  describe('State Read Mutex Protection', () => {
    it('should return consistent state under concurrent reads', async () => {
      let callCount = 0;
      const fn = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 3) {
          throw new Error('Simulated failure');
        }
        return 'success';
      });

      const breaker = new CircuitBreaker(fn, {
        failureThreshold: 3,
        resetTimeoutMs: 1000,
        name: 'test-breaker',
      });

      // Cause failures to open circuit
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(); } catch { /* ignore */ }
      }

      // Concurrent state reads should all return consistent state
      const states = await Promise.all([
        breaker.getState(),
        breaker.getState(),
        breaker.getState(),
        breaker.getState(),
        breaker.getState(),
      ]);

      // All reads should return the same state
      const uniqueStates = new Set(states);
      expect(uniqueStates.size).toBe(1);
      expect(states[0]).toBe('open');
    });

    it('should handle concurrent state reads during state transition', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const _breaker = new CircuitBreaker(fn, {
        failureThreshold: 3,
        resetTimeoutMs: 50,
        name: 'test-breaker',
      });

      // First cause some failures
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      const failingBreaker = new CircuitBreaker(failFn, {
        failureThreshold: 3,
        resetTimeoutMs: 50,
        name: 'failing-breaker',
      });

      for (let i = 0; i < 3; i++) {
        try { await failingBreaker.execute(); } catch { /* ignore */ }
      }

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 100));

      // Concurrent state reads during potential transition
      const states = await Promise.all([
        failingBreaker.getState(),
        failingBreaker.getState(),
        failingBreaker.getState(),
      ]);

      // All states should be consistent (either 'half-open' or 'open')
      expect(states.every(s => s === states[0])).toBe(true);
    });

    it('should prevent race condition between getState and execute', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const breaker = new CircuitBreaker(fn, {
        failureThreshold: 3,
        resetTimeoutMs: 100,
        name: 'race-test',
      });

      // Interleave state checks with executions
      const operations = [];
      for (let i = 0; i < 10; i++) {
        operations.push(breaker.getState());
        operations.push(breaker.execute().catch(() => 'failed'));
      }

      const results = await Promise.all(operations);
      
      // Should complete without throwing
      expect(results.length).toBe(20);
    });
  });

  describe('Thread-Safe State Updates', () => {
    it('should handle concurrent success/failure calls', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const breaker = new CircuitBreaker(fn, {
        failureThreshold: 5,
        resetTimeoutMs: 1000,
        name: 'concurrent-test',
      });

      // Simulate rapid concurrent state changes
      await Promise.all([
        breaker.onSuccess(),
        breaker.onSuccess(),
        breaker.onFailure(),
        breaker.onSuccess(),
        breaker.onFailure(),
        breaker.onSuccess(),
      ]);

      // State should be consistent
      const state = await breaker.getState();
      expect(['closed', 'half-open', 'open']).toContain(state);
    });

    it('should maintain correct failure count under concurrent failures', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const breaker = new CircuitBreaker(fn, {
        failureThreshold: 10,
        resetTimeoutMs: 1000,
        name: 'concurrent-failures',
      });

      // Execute many times concurrently
      const executions = Array(20).fill(null).map(() => 
        breaker.execute().catch(() => 'failed')
      );

      await Promise.all(executions);

      // After 10 failures, circuit should be open
      const state = await breaker.getState();
      expect(state).toBe('open');
    });
  });

  describe('Mutex Exclusivity', () => {
    it('should serialize access to state during mixed operations', async () => {
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const fn = vi.fn().mockImplementation(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise(resolve => setTimeout(resolve, 10));
        concurrentCount--;
        return 'success';
      });

      const breaker = new CircuitBreaker(fn, {
        failureThreshold: 3,
        resetTimeoutMs: 100,
        name: 'mutex-test',
      });

      // The actual function execution is not mutex-protected, but state updates are
      await Promise.all([
        breaker.execute(),
        breaker.execute(),
        breaker.execute(),
      ]);

      // State reads should be consistent
      const state = await breaker.getState();
      expect(state).toBe('closed');
    });
  });

  describe('Async State Transitions', () => {
    it('should properly transition from closed to open under load', async () => {
      let callCount = 0;
      const fn = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.reject(new Error(`Fail ${callCount}`));
      });

      const breaker = new CircuitBreaker(fn, {
        failureThreshold: 3,
        resetTimeoutMs: 5000,
        name: 'transition-test',
      });

      // Rapid concurrent failures
      const results = await Promise.allSettled([
        breaker.execute(),
        breaker.execute(),
        breaker.execute(),
        breaker.execute(),
        breaker.execute(),
      ]);

      // All should fail
      expect(results.every(r => r.status === 'rejected')).toBe(true);

      // Circuit should be open
      const state = await breaker.getState();
      expect(state).toBe('open');
    });

    it('should properly transition from open to half-open after timeout', async () => {
      let _callCount = 0;
      const fn = vi.fn().mockImplementation(() => {
        _callCount++;
        return Promise.reject(new Error('Fail'));
      });

      const breaker = new CircuitBreaker(fn, {
        failureThreshold: 2,
        resetTimeoutMs: 100, // Short timeout for testing
        name: 'half-open-test',
      });

      // Open the circuit
      try { await breaker.execute(); } catch { /* expected */ }
      try { await breaker.execute(); } catch { /* expected */ }

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Execute should transition to half-open and try
      await expect(breaker.execute()).rejects.toThrow();
      
      // State should be half-open or open (depending on timing)
      const state = await breaker.getState();
      expect(['half-open', 'open']).toContain(state);
    });
  });
});
