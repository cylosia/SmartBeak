import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CircuitBreaker, CircuitState } from '../retry';

describe('Circuit Breaker Error Classification (P1-FIX)', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker('test-circuit', {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenMaxCalls: 1,
    });
  });

  describe('4xx errors should NOT count toward circuit breaker', () => {
    it('should not count 400 Bad Request errors', async () => {
      const fn = jest.fn().mockRejectedValue({ statusCode: 400, message: 'Bad Request' });
      
      // Execute multiple times - all should throw but not open circuit
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected to throw
        }
      }
      
      // Circuit should still be closed (4xx errors don't count)
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
      expect(fn).toHaveBeenCalledTimes(5);
    });

    it('should not count 401 Unauthorized errors', async () => {
      const fn = jest.fn().mockRejectedValue({ statusCode: 401, message: 'Unauthorized' });
      
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should not count 403 Forbidden errors', async () => {
      const fn = jest.fn().mockRejectedValue({ statusCode: 403, message: 'Forbidden' });
      
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should not count 404 Not Found errors', async () => {
      const fn = jest.fn().mockRejectedValue({ statusCode: 404, message: 'Not Found' });
      
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should not count 422 Validation Error', async () => {
      const fn = jest.fn().mockRejectedValue({ statusCode: 422, message: 'Validation Failed' });
      
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should not count errors with client error codes', async () => {
      const clientErrorCodes = [
        { code: 'BAD_REQUEST', message: 'Error' },
        { code: 'VALIDATION_ERROR', message: 'Error' },
        { code: 'EINVAL', message: 'Error' },
        { code: 'ENOENT', message: 'Error' },
      ];
      
      for (const errorCode of clientErrorCodes) {
        const cb = new CircuitBreaker(`test-${errorCode.code}`, {
          failureThreshold: 3,
          resetTimeoutMs: 1000,
          halfOpenMaxCalls: 1,
        });
        
        const fn = jest.fn().mockRejectedValue(errorCode);
        
        for (let i = 0; i < 5; i++) {
          try {
            await cb.execute(fn);
          } catch (e) {
            // Expected
          }
        }
        
        expect(cb.getState()).toBe(CircuitState.CLOSED);
      }
    });

    it('should not count errors with client error message patterns', async () => {
      const clientErrorMessages = [
        'Validation failed: invalid input',
        'Bad request from client',
        'Unauthorized access attempt',
        'Forbidden resource access',
        'Not found in database',
      ];
      
      for (const message of clientErrorMessages) {
        const cb = new CircuitBreaker(`test-${message.slice(0, 10)}`, {
          failureThreshold: 3,
          resetTimeoutMs: 1000,
          halfOpenMaxCalls: 1,
        });
        
        const fn = jest.fn().mockRejectedValue(new Error(message));
        
        for (let i = 0; i < 5; i++) {
          try {
            await cb.execute(fn);
          } catch (e) {
            // Expected
          }
        }
        
        expect(cb.getState()).toBe(CircuitState.CLOSED);
      }
    });
  });

  describe('5xx and service errors SHOULD count toward circuit breaker', () => {
    it('should count 500 Internal Server Error', async () => {
      const fn = jest.fn().mockRejectedValue({ statusCode: 500, message: 'Internal Server Error' });
      
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      // Circuit should be open after 3 failures
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should count 502 Bad Gateway', async () => {
      const fn = jest.fn().mockRejectedValue({ statusCode: 502, message: 'Bad Gateway' });
      
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should count 503 Service Unavailable', async () => {
      const fn = jest.fn().mockRejectedValue({ statusCode: 503, message: 'Service Unavailable' });
      
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should count network errors (ECONNREFUSED)', async () => {
      const error = new Error('ECONNREFUSED');
      const fn = jest.fn().mockRejectedValue(error);
      
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should count timeout errors', async () => {
      const error = new Error('Request timeout');
      const fn = jest.fn().mockRejectedValue(error);
      
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('Mixed error types', () => {
    it('should only count service errors when mixed with client errors', async () => {
      // First 2 failures are client errors (ignored)
      // Next 3 are server errors (should open circuit)
      const errors = [
        { statusCode: 400, message: 'Bad Request' },
        { statusCode: 404, message: 'Not Found' },
        { statusCode: 500, message: 'Server Error' },
        { statusCode: 500, message: 'Server Error' },
        { statusCode: 500, message: 'Server Error' },
      ];
      
      let callIndex = 0;
      const fn = jest.fn().mockImplementation(() => {
        return Promise.reject(errors[callIndex++]);
      });
      
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      // Circuit should be open after 3 server errors
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('Error propagation', () => {
    it('should still propagate client errors to caller', async () => {
      const clientError = { statusCode: 400, message: 'Bad Request' };
      const fn = jest.fn().mockRejectedValue(clientError);
      
      await expect(circuitBreaker.execute(fn)).rejects.toEqual(clientError);
    });

    it('should still propagate server errors to caller', async () => {
      const serverError = { statusCode: 500, message: 'Server Error' };
      const fn = jest.fn().mockRejectedValue(serverError);
      
      await expect(circuitBreaker.execute(fn)).rejects.toEqual(serverError);
    });
  });
});
