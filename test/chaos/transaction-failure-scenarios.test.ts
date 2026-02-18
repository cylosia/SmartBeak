/**
 * Chaos/Failure Tests: Transaction Failure Scenarios
 *
 * Tests database transaction behavior under fault injection:
 * - Transaction timeout mid-query → rollback + connection release
 * - COMMIT failure → rollback attempted → TransactionError
 * - Rollback failure → TransactionError chains both errors
 * - Connection lost mid-transaction → cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PoolClient } from 'pg';

vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@database/pool', async () => {
  return {
    getPool: vi.fn(),
    getConnectionMetrics: vi.fn().mockReturnValue({
      totalQueries: 0,
      failedQueries: 0,
      slowQueries: 0,
      activeConnections: 0,
      waitingClients: 0,
    }),
  };
});

import { getPool } from '@database/pool';
import { withTransaction, TransactionError } from '@database/transactions';

describe('Transaction - Failure Scenarios', () => {
  let mockClient: Partial<PoolClient> & {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    _isReleased?: boolean;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith('BEGIN') || sql.startsWith('SET')) {
          return Promise.resolve({});
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      release: vi.fn(),
      _isReleased: false,
    };

    (getPool as ReturnType<typeof vi.fn>).mockResolvedValue({
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn().mockResolvedValue({ rows: [] }),
      on: vi.fn(),
      totalCount: 10,
      idleCount: 5,
      waitingCount: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Transaction Timeout', () => {
    it('should rollback and release connection when timeout is exceeded', async () => {
      await expect(
        withTransaction(
          async (_client, _signal) => {
            // Simulate slow query that exceeds timeout
            await new Promise(resolve => setTimeout(resolve, 200));
            return 'should-not-reach';
          },
          { timeoutMs: 50 }
        )
      ).rejects.toThrow('Transaction timeout after 50ms');

      // Should have attempted ROLLBACK
      const rollbackCalls = mockClient.query.mock.calls.filter(
        (c: unknown[]) => c[0] === 'ROLLBACK'
      );
      expect(rollbackCalls.length).toBeGreaterThanOrEqual(1);

      // Connection should be released (with error flag for timeout)
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('COMMIT Failure', () => {
    it('should attempt rollback when COMMIT fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      mockClient.query.mockImplementation((sql: string) => {
        if (sql === 'COMMIT') {
          return Promise.reject(new Error('COMMIT failed: disk full'));
        }
        if (sql === 'ROLLBACK' || sql.startsWith('BEGIN') || sql.startsWith('SET')) {
          return Promise.resolve({});
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        withTransaction(async (client, _signal) => {
          await client.query('SELECT 1');
          return 'result';
        })
      ).rejects.toThrow('COMMIT failed');

      // Should have attempted ROLLBACK after COMMIT failure
      const rollbackCalls = mockClient.query.mock.calls.filter(
        (c: unknown[]) => c[0] === 'ROLLBACK'
      );
      expect(rollbackCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Rollback Failure', () => {
    it('should throw TransactionError chaining both original and rollback errors', async () => {
      const originalError = new Error('Query failed: constraint violation');
      const rollbackError = new Error('ROLLBACK failed: connection lost');

      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      mockClient.query.mockImplementation((sql: string) => {
        if (sql.startsWith('BEGIN') || sql.startsWith('SET')) {
          return Promise.resolve({});
        }
        if (sql === 'ROLLBACK') {
          return Promise.reject(rollbackError);
        }
        if (sql === 'SELECT 1') {
          return Promise.reject(originalError);
        }
        return Promise.resolve({ rows: [] });
      });

      try {
        await withTransaction(async (client, _signal) => {
          await client.query('SELECT 1');
          return 'result';
        });
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TransactionError);
        if (!(error instanceof TransactionError)) throw new Error('Expected TransactionError');
        const txError = error;
        expect(txError.originalError).toBe(originalError);
        expect(txError.rollbackError).toBe(rollbackError);
        expect(txError.hasRollbackFailure).toBe(true);
        expect(txError.rootCause).toBe(originalError);
      }
    });

    it('should release client with error flag when rollback fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      mockClient.query.mockImplementation((sql: string) => {
        if (sql.startsWith('BEGIN') || sql.startsWith('SET')) {
          return Promise.resolve({});
        }
        if (sql === 'ROLLBACK') {
          return Promise.reject(new Error('ROLLBACK failed'));
        }
        return Promise.reject(new Error('Query failed'));
      });

      try {
        await withTransaction(async (client, _signal) => {
          await client.query('SELECT 1');
          return 'result';
        });
      } catch {
        // Expected
      }

      // Client should be released with error flag (true)
      expect(mockClient.release).toHaveBeenCalledWith(true);
    });
  });

  describe('Connection Lost Mid-Transaction', () => {
    it('should release client even when connection is lost during query', async () => {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      mockClient.query.mockImplementation((sql: string) => {
        if (sql.startsWith('BEGIN') || sql.startsWith('SET')) {
          return Promise.resolve({});
        }
        if (sql === 'ROLLBACK') {
          return Promise.reject(new Error('Connection terminated'));
        }
        // Simulate connection loss
        return Promise.reject(new Error('Connection terminated unexpectedly'));
      });

      try {
        await withTransaction(async (client, _signal) => {
          await client.query('SELECT * FROM users');
          return 'result';
        });
      } catch {
        // Expected
      }

      // Client should still be released
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Isolation Level Validation', () => {
    it('should reject invalid isolation levels', async () => {
      await expect(
        withTransaction(
          async (_client, _signal) => 'result',
          { isolationLevel: 'INVALID' as unknown as 'READ COMMITTED' }
        )
      ).rejects.toThrow('Invalid isolation level');
    });

    it('should accept valid isolation levels', async () => {
      const levels = ['READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'] as const;

      for (const level of levels) {
        const result = await withTransaction(
          async (_client, _signal) => `level-${level}`,
          { isolationLevel: level }
        );
        expect(result).toBe(`level-${level}`);
      }
    });
  });

  describe('TransactionError Serialization', () => {
    it('should serialize to JSON with all error context', () => {
      const original = new Error('Original failure');
      const rollback = new Error('Rollback failure');
      const txError = new TransactionError('Both failed', original, rollback);

      const json = txError.toJSON();

      expect(json.name).toBe('TransactionError');
      expect(json.message).toBe('Both failed');
      expect(json.originalError).toBe('Original failure');
      expect(json.rollbackError).toBe('Rollback failure');
    });
  });
});
