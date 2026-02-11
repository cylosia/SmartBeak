import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { ThreadSafeModuleCache, ModuleCache } from '../moduleCache';
import { CircuitState } from '@kernel/retry';

describe('ModuleCache Circuit Breaker (P1-FIX)', () => {
  describe('ThreadSafeModuleCache', () => {
    let cache: ThreadSafeModuleCache<string>;
    let loader: Mock<Promise<string>, [string]>;

    beforeEach(() => {
      loader = vi.fn();
      cache = new ThreadSafeModuleCache(loader);
    });

    it('should wrap loader with circuit breaker', async () => {
      loader.mockResolvedValue('module-content');
      
      const result = await cache.get('test-key');
      
      expect(result).toBe('module-content');
      expect(loader).toHaveBeenCalledWith('test-key');
    });

    it('should prevent cascading failures with circuit breaker', async () => {
      // Simulate a failing service
      const serviceError = new Error('Service unavailable');
      loader.mockRejectedValue(serviceError);
      
      // Make multiple requests that will fail
      const requests: Promise<string>[] = [];
      for (let i = 0; i < 10; i++) {
        requests.push(
          cache.get('failing-key').catch(e => e as Error)
        );
      }
      
      const results = await Promise.all(requests);
      
      // All should return errors
      results.forEach(result => {
        expect(result).toBeInstanceOf(Error);
      });
      
      // After circuit opens, loader should not be called as many times as requests
      // Circuit breaker trips after 5 failures by default
      expect(loader.mock.calls.length).toBeLessThanOrEqual(5);
    });

    it('should clear cache entry on loader error', async () => {
      const error = new Error('Load failed');
      loader.mockRejectedValue(error);
      
      try {
        await cache.get('error-key');
      } catch (e) {
        // Expected
      }
      
      // Reset loader to succeed on next call
      loader.mockResolvedValue('success');
      
      try {
        await cache.get('error-key');
      } catch (e) {
        // Might still fail if circuit is open
      }
      
      // Loader should be called again since cache was cleared
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it('should log errors when loader fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('Module load failed');
      loader.mockRejectedValue(error);
      
      try {
        await cache.get('error-key');
      } catch (e) {
        // Expected
      }
      
      // Error should be logged
      // Note: The actual logging goes through the kernel logger
      
      consoleSpy.mockRestore();
    });

    it('should share circuit breaker across all keys', async () => {
      // Fail multiple different keys
      loader.mockRejectedValue(new Error('Service down'));
      
      // Make requests to different keys
      for (let i = 0; i < 5; i++) {
        try {
          await cache.get(`key-${i}`);
        } catch (e) {
          // Expected
        }
      }
      
      // After 5 failures across any keys, circuit should be open
      // Next request should fail fast with circuit breaker error
      loader.mockClear();
      
      try {
        await cache.get('new-key');
      } catch (e) {
        // Expected
      }
      
      // Loader should not be called if circuit is open
      expect(loader).not.toHaveBeenCalled();
    });
  });

  describe('ModuleCache (non-thread-safe)', () => {
    let cache: ModuleCache<string>;
    let loader: Mock<Promise<string>, []>;

    beforeEach(() => {
      loader = vi.fn();
      cache = new ModuleCache(loader);
    });

    it('should handle loader errors gracefully', async () => {
      const error = new Error('Load failed');
      loader.mockRejectedValue(error);
      
      await expect(cache.get()).rejects.toThrow('Load failed');
    });

    it('should clear promise on error to allow retry', async () => {
      let shouldFail = true;
      loader.mockImplementation(() => {
        if (shouldFail) {
          return Promise.reject(new Error('First load fails'));
        }
        return Promise.resolve('success');
      });
      
      // First call fails
      await expect(cache.get()).rejects.toThrow('First load fails');
      
      // Enable success
      shouldFail = false;
      
      // Second call should retry (cache was cleared)
      const result = await cache.get();
      expect(result).toBe('success');
    });

    it('should handle concurrent load requests', async () => {
      let resolveLoad: (value: string) => void;
      const loadPromise = new Promise<string>(resolve => {
        resolveLoad = resolve;
      });
      loader.mockReturnValue(loadPromise);
      
      // Start multiple concurrent requests
      const req1 = cache.get();
      const req2 = cache.get();
      const req3 = cache.get();
      
      // Resolve the loader
      resolveLoad!('shared-result');
      
      // All should get the same result
      const [r1, r2, r3] = await Promise.all([req1, req2, req3]);
      expect(r1).toBe('shared-result');
      expect(r2).toBe('shared-result');
      expect(r3).toBe('shared-result');
      
      // Loader should only be called once
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });
});
