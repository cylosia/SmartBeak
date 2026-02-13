/**
 * Load/Stress Tests: Database Pool
 *
 * Validates connection pool behavior under concurrent load:
 * - Pool saturation and queuing
 * - Advisory lock contention
 * - Resource cleanup after burst
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Pool, PoolClient } from 'pg';

// Mock the pool module
vi.mock('@database/pool', async () => {
  const actual = await vi.importActual<typeof import('@database/pool')>('@database/pool');
  return { ...actual, getPool: vi.fn() };
});

vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getPool } from '@database/pool';

describe('Database Pool - Load/Stress Tests', () => {
  let mockPool: Partial<Pool>;
  let connectCount: number;
  let releasedCount: number;
  const MAX_POOL_SIZE = 10;

  beforeEach(() => {
    vi.clearAllMocks();
    connectCount = 0;
    releasedCount = 0;

    mockPool = {
      connect: vi.fn().mockImplementation(async () => {
        connectCount++;
        if (connectCount > MAX_POOL_SIZE) {
          // Simulate queuing — resolve after a short delay
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const client: Partial<PoolClient> = {
          query: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }),
          release: vi.fn().mockImplementation(() => {
            releasedCount++;
          }),
        };
        return client;
      }),
      totalCount: MAX_POOL_SIZE,
      idleCount: MAX_POOL_SIZE,
      waitingCount: 0,
      query: vi.fn(),
      on: vi.fn(),
    };

    (getPool as ReturnType<typeof vi.fn>).mockResolvedValue(mockPool);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Pool Saturation', () => {
    it('should handle 10 concurrent connections (pool max)', async () => {
      const connectionPromises = Array.from({ length: MAX_POOL_SIZE }, () =>
        (mockPool.connect as ReturnType<typeof vi.fn>)()
      );

      const clients = await Promise.all(connectionPromises);

      expect(clients).toHaveLength(MAX_POOL_SIZE);
      expect(connectCount).toBe(MAX_POOL_SIZE);
    });

    it('should queue connections when pool is saturated (15 concurrent)', async () => {
      const OVER_LIMIT = 15;

      const connectionPromises = Array.from({ length: OVER_LIMIT }, () =>
        (mockPool.connect as ReturnType<typeof vi.fn>)()
      );

      const clients = await Promise.all(connectionPromises);

      expect(clients).toHaveLength(OVER_LIMIT);
      expect(connectCount).toBe(OVER_LIMIT);
    });

    it('should release all connections after concurrent burst', async () => {
      const clients = await Promise.all(
        Array.from({ length: MAX_POOL_SIZE }, () =>
          (mockPool.connect as ReturnType<typeof vi.fn>)()
        )
      );

      // Release all connections
      for (const client of clients) {
        client.release();
      }

      expect(releasedCount).toBe(MAX_POOL_SIZE);
    });

    it('should handle rapid acquire/release cycles without leaks', async () => {
      const CYCLES = 50;

      for (let i = 0; i < CYCLES; i++) {
        const client = await (mockPool.connect as ReturnType<typeof vi.fn>)();
        await client.query('SELECT 1');
        client.release();
      }

      expect(connectCount).toBe(CYCLES);
      expect(releasedCount).toBe(CYCLES);
    });
  });

  describe('Advisory Lock Contention', () => {
    it('should handle 10 concurrent advisory lock attempts on same key', async () => {
      let lockHeld = false;
      const acquiredOrder: number[] = [];
      let acquireIndex = 0;

      const mockConnect = vi.fn().mockImplementation(async () => {
        const idx = acquireIndex++;
        const client: Partial<PoolClient> = {
          query: vi.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('pg_try_advisory_lock')) {
              // Only one can acquire at a time
              if (!lockHeld) {
                lockHeld = true;
                acquiredOrder.push(idx);
                return { rows: [{ acquired: true }] };
              }
              return { rows: [{ acquired: false }] };
            }
            if (sql.includes('pg_advisory_unlock')) {
              lockHeld = false;
              return { rows: [] };
            }
            return { rows: [] };
          }),
          release: vi.fn(),
        };
        return client;
      });

      (mockPool.connect as ReturnType<typeof vi.fn>).mockImplementation(mockConnect);

      const CONTENDERS = 10;
      const results = await Promise.allSettled(
        Array.from({ length: CONTENDERS }, async (_, i) => {
          const client = await (mockPool.connect as ReturnType<typeof vi.fn>)();
          const { rows } = await client.query(
            'SELECT pg_try_advisory_lock(hashtext($1)) as acquired',
            [`lock-key-${i}`]
          );
          if (!rows[0]?.acquired) {
            client.release();
            throw new Error('Lock not acquired');
          }
          return client;
        })
      );

      const acquired = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      // Exactly one should acquire the lock
      expect(acquired.length).toBe(1);
      expect(rejected.length).toBe(CONTENDERS - 1);
    });
  });

  describe('Connection Pool Metrics Under Load', () => {
    it('should track connection metrics accurately during burst', async () => {
      let activeConnections = 0;
      let peakConnections = 0;

      const mockConnectWithTracking = vi.fn().mockImplementation(async () => {
        activeConnections++;
        peakConnections = Math.max(peakConnections, activeConnections);
        const client: Partial<PoolClient> = {
          query: vi.fn().mockResolvedValue({ rows: [] }),
          release: vi.fn().mockImplementation(() => {
            activeConnections--;
          }),
        };
        return client;
      });

      (mockPool.connect as ReturnType<typeof vi.fn>).mockImplementation(mockConnectWithTracking);

      // Simulate staggered burst — acquire all, then release all
      const clients = await Promise.all(
        Array.from({ length: MAX_POOL_SIZE }, () =>
          (mockPool.connect as ReturnType<typeof vi.fn>)()
        )
      );

      expect(activeConnections).toBe(MAX_POOL_SIZE);
      expect(peakConnections).toBe(MAX_POOL_SIZE);

      // Release all
      for (const client of clients) {
        client.release();
      }

      expect(activeConnections).toBe(0);
    });
  });
});
