/**
 * P1 TEST: Distributed Locking (Redlock) Tests
 *
 * Tests lock acquisition, release, extension, withLock helper,
 * contention handling, and lock information queries.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  acquireLock,
  acquireLockWithRetry,
  releaseLock,
  extendLock,
  withLock,
  isLocked,
  getLockInfo,
} from '../redlock';

// Mock Redis
const mockRedis = {
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  eval: vi.fn(),
  exists: vi.fn(),
  pttl: vi.fn(),
};

vi.mock('../redis', () => ({
  getRedis: vi.fn().mockResolvedValue(mockRedis),
}));

// Mock logger
vi.mock('../logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Distributed Locking (Redlock)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.set.mockResolvedValue(null);
    mockRedis.eval.mockResolvedValue(0);
    mockRedis.exists.mockResolvedValue(0);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.pttl.mockResolvedValue(-2);
  });

  // ============================================================================
  // acquireLock
  // ============================================================================

  describe('acquireLock', () => {
    it('should acquire lock when resource is available', async () => {
      mockRedis.set.mockResolvedValue('OK');

      const lock = await acquireLock('test-resource');
      expect(lock).not.toBeNull();
      expect(lock!.resource).toBe('test-resource');
      expect(lock!.value).toBeDefined();
      expect(lock!.expiration).toBeGreaterThan(Date.now());
    });

    it('should return null when resource is already locked', async () => {
      mockRedis.set.mockResolvedValue(null);

      const lock = await acquireLock('test-resource');
      expect(lock).toBeNull();
    });

    it('should use SET NX PX for atomic acquisition', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await acquireLock('my-resource', { ttl: 5000 });
      expect(mockRedis.set).toHaveBeenCalledWith(
        'lock:my-resource',
        expect.any(String),
        'PX',
        5000,
        'NX',
      );
    });

    it('should use default TTL of 10000ms', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await acquireLock('resource');
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'PX',
        10000,
        'NX',
      );
    });
  });

  // ============================================================================
  // acquireLockWithRetry
  // ============================================================================

  describe('acquireLockWithRetry', () => {
    it('should return lock on first attempt if available', async () => {
      mockRedis.set.mockResolvedValue('OK');

      const lock = await acquireLockWithRetry('resource', { retryCount: 3, retryDelay: 10 });
      expect(lock).not.toBeNull();
      expect(mockRedis.set).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed on later attempt', async () => {
      mockRedis.set
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('OK');

      const lock = await acquireLockWithRetry('resource', { retryCount: 5, retryDelay: 10 });
      expect(lock).not.toBeNull();
      expect(mockRedis.set).toHaveBeenCalledTimes(3);
    });

    it('should return null after all retries fail', async () => {
      mockRedis.set.mockResolvedValue(null);

      const lock = await acquireLockWithRetry('resource', { retryCount: 3, retryDelay: 10 });
      expect(lock).toBeNull();
      expect(mockRedis.set).toHaveBeenCalledTimes(3);
    });
  });

  // ============================================================================
  // releaseLock
  // ============================================================================

  describe('releaseLock', () => {
    it('should release lock with matching value', async () => {
      mockRedis.eval.mockResolvedValue(1);

      const released = await releaseLock({
        resource: 'test',
        value: 'my-lock-value',
        expiration: Date.now() + 10000,
      });
      expect(released).toBe(true);
    });

    it('should return false for non-matching lock value', async () => {
      mockRedis.eval.mockResolvedValue(0);

      const released = await releaseLock({
        resource: 'test',
        value: 'wrong-value',
        expiration: Date.now() + 10000,
      });
      expect(released).toBe(false);
    });

    it('should use Lua script for atomic check-and-delete', async () => {
      mockRedis.eval.mockResolvedValue(1);

      await releaseLock({
        resource: 'res',
        value: 'val',
        expiration: Date.now() + 10000,
      });

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call'),
        1,
        'lock:res',
        'val',
      );
    });
  });

  // ============================================================================
  // extendLock
  // ============================================================================

  describe('extendLock', () => {
    it('should extend lock TTL when lock is held', async () => {
      mockRedis.eval.mockResolvedValue(1);

      const lock = {
        resource: 'test',
        value: 'lock-val',
        expiration: Date.now() + 5000,
      };

      const extended = await extendLock(lock, 15000);
      expect(extended).toBe(true);
    });

    it('should return false when lock is no longer held', async () => {
      mockRedis.eval.mockResolvedValue(0);

      const lock = {
        resource: 'test',
        value: 'expired-val',
        expiration: Date.now() - 1000,
      };

      const extended = await extendLock(lock, 15000);
      expect(extended).toBe(false);
    });
  });

  // ============================================================================
  // withLock
  // ============================================================================

  describe('withLock', () => {
    it('should execute function and release lock', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.eval.mockResolvedValue(1);

      const fn = vi.fn().mockResolvedValue('result');
      const result = await withLock('resource', fn, { retryCount: 1, retryDelay: 10 });

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockRedis.eval).toHaveBeenCalled(); // releaseLock called
    });

    it('should release lock even if function throws', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.eval.mockResolvedValue(1);

      const fn = vi.fn().mockRejectedValue(new Error('fn failed'));

      await expect(withLock('resource', fn, { retryCount: 1, retryDelay: 10 })).rejects.toThrow('fn failed');
      expect(mockRedis.eval).toHaveBeenCalled(); // releaseLock still called
    });

    it('should throw if lock cannot be acquired', async () => {
      mockRedis.set.mockResolvedValue(null);

      await expect(
        withLock('resource', vi.fn(), { retryCount: 1, retryDelay: 10 }),
      ).rejects.toThrow('Could not acquire lock');
    });
  });

  // ============================================================================
  // isLocked
  // ============================================================================

  describe('isLocked', () => {
    it('should return true when lock exists', async () => {
      mockRedis.exists.mockResolvedValue(1);
      expect(await isLocked('resource')).toBe(true);
    });

    it('should return false when lock does not exist', async () => {
      mockRedis.exists.mockResolvedValue(0);
      expect(await isLocked('resource')).toBe(false);
    });
  });

  // ============================================================================
  // getLockInfo
  // ============================================================================

  describe('getLockInfo', () => {
    it('should return lock info when locked', async () => {
      mockRedis.get.mockResolvedValue('lock-value-123');
      mockRedis.pttl.mockResolvedValue(5000);

      const info = await getLockInfo('resource');
      expect(info).not.toBeNull();
      expect(info!.value).toBe('lock-value-123');
      expect(info!.ttl).toBe(5000);
    });

    it('should return null when not locked', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.pttl.mockResolvedValue(-2);

      const info = await getLockInfo('resource');
      expect(info).toBeNull();
    });

    it('should handle no-TTL lock', async () => {
      mockRedis.get.mockResolvedValue('lock-value');
      mockRedis.pttl.mockResolvedValue(-1);

      const info = await getLockInfo('resource');
      expect(info!.ttl).toBe(0);
    });
  });
});
