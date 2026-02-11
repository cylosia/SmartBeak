/**
 * P2 TEST: Database Transaction Tests
 * 
 * Tests transaction rollback, connection pool exhaustion handling,
 * and advisory lock timeouts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTransaction, query, withLock, batchInsert } from '../transactions';
import { getPool, acquireAdvisoryLock, releaseAdvisoryLock } from '../pool';
import { Pool, PoolClient } from 'pg';

// Mock the pool module
vi.mock('../pool', async () => {
  const actual = await vi.importActual('../pool') as any;
  return {
    ...actual,
    getPool: vi.fn(),
  };
});

describe('Database Transaction Tests', () => {
  let mockPool: Partial<Pool>;
  let mockClient: Partial<PoolClient> & { 
    _isReleased?: boolean;
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
      _isReleased: false,
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn(),
      on: vi.fn(),
      totalCount: 10,
      idleCount: 5,
      waitingCount: 0,
      options: { max: 10 },
    };

    (getPool as any).mockResolvedValue(mockPool);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Transaction Rollback on Error', () => {
    it('should rollback transaction when function throws error', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // ROLLBACK
        .mockResolvedValueOnce({ rows: [] }); // COMMIT (not called)

      const testError = new Error('Test transaction failure');
      
      await expect(
        withTransaction(async (client) => {
          await client.query('INSERT INTO test VALUES (1)');
          throw testError;
        })
      ).rejects.toThrow('Test transaction failure');

      // Verify ROLLBACK was called
      const calls = mockClient.query.mock.calls;
      const rollbackCall = calls.find((call: any[]) => call[0] === 'ROLLBACK');
      expect(rollbackCall).toBeDefined();
    });

    it('should commit transaction when function succeeds', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // COMMIT
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // query result

      const result = await withTransaction(async (client) => {
        await client.query('INSERT INTO test VALUES (1)');
        return { success: true };
      });

      expect(result).toEqual({ success: true });
      
      // Verify COMMIT was called
      const calls = mockClient.query.mock.calls;
      const commitCall = calls.find((call: any[]) => call[0] === 'COMMIT');
      expect(commitCall).toBeDefined();
    });

    it('should handle rollback failure gracefully', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('Rollback failed')) // ROLLBACK fails
        .mockResolvedValueOnce({}); // release

      await expect(
        withTransaction(async () => {
          throw new Error('Original error');
        })
      ).rejects.toThrow('Original error');

      // Should still release client even if rollback fails
      expect(mockClient.release).toHaveBeenCalledWith(true);
    });

    it('should use correct isolation level when specified', async () => {
      mockClient.query.mockResolvedValue({});

      await withTransaction(async () => 'done', { 
        isolationLevel: 'SERIALIZABLE' 
      });

      const calls = mockClient.query.mock.calls;
      const beginCall = calls.find((call: any[]) => 
        call[0].includes('BEGIN')
      );
      expect(beginCall[0]).toContain('ISOLATION LEVEL SERIALIZABLE');
    });

    it('should reject invalid isolation levels', async () => {
      await expect(
        withTransaction(async () => 'done', { 
          isolationLevel: 'INVALID' as any 
        })
      ).rejects.toThrow('Invalid isolation level');
    });
  });

  describe('Connection Pool Exhaustion Handling', () => {
    it('should handle pool connection timeout', async () => {
      (mockPool.connect as any).mockRejectedValue(
        new Error('timeout: connection pool exhausted')
      );

      await expect(
        withTransaction(async () => 'done')
      ).rejects.toThrow('timeout');
    });

    it('should track connection metrics during pool stress', async () => {
      // Simulate pool under stress
      mockPool.totalCount = 10;
      mockPool.idleCount = 0;
      mockPool.waitingCount = 15;

      mockClient.query.mockResolvedValue({});

      await withTransaction(async () => 'done');

      // Connection should still be acquired
      expect(mockPool.connect).toHaveBeenCalled();
    });

    it('should prevent double-release of clients', async () => {
      mockClient.query.mockResolvedValue({});

      await withTransaction(async () => {
        // Simulate client already released
        mockClient._isReleased = true;
        return 'done';
      });

      // Should handle gracefully without throwing
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle connection errors during transaction', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('Connection lost')); // Query fails

      await expect(
        withTransaction(async (client) => {
          await client.query('SELECT 1');
          return 'done';
        })
      ).rejects.toThrow('Connection lost');

      // Should still attempt rollback
      const calls = mockClient.query.mock.calls;
      const rollbackCall = calls.find((call: any[]) => call[0] === 'ROLLBACK');
      expect(rollbackCall).toBeDefined();
    });
  });

  describe('Advisory Lock Timeouts', () => {
    it('should acquire advisory lock successfully', async () => {
      mockClient.query.mockResolvedValue({
        rows: [{ acquired: true }],
      });

      const result = await acquireAdvisoryLock('test-lock', 5000);
      
      // Now returns PoolClient instead of boolean
      expect(result).toBe(mockClient);
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT pg_try_advisory_lock($1) as acquired',
        ['test-lock']
      );
      // Client should NOT be released when lock is acquired
      expect(mockClient.release).not.toHaveBeenCalled();
    });

    it('should release client when lock acquisition fails', async () => {
      mockClient.query.mockResolvedValue({
        rows: [{ acquired: false }],
      });

      // Should throw timeout error when lock cannot be acquired
      await expect(acquireAdvisoryLock('test-lock', 100)).rejects.toThrow(
        'Failed to acquire advisory lock test-lock within 100ms'
      );
      
      // Client should be released when lock is not acquired
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should release advisory lock', async () => {
      mockClient.query.mockResolvedValue({});

      // Now takes client as first parameter
      await releaseAdvisoryLock(mockClient as PoolClient, 'test-lock');
      
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1)',
        ['test-lock']
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should timeout waiting for advisory lock', async () => {
      // Simulate lock held by another session
      mockClient.query.mockResolvedValue({ rows: [{ acquired: false }] });

      // Should throw timeout error
      await expect(acquireAdvisoryLock('test-lock', 50)).rejects.toThrow(
        'Failed to acquire advisory lock test-lock within 50ms'
      );
    });

    it('should release client on error during lock acquisition', async () => {
      mockClient.query.mockRejectedValue(new Error('Database error'));

      await expect(acquireAdvisoryLock('test-lock', 5000)).rejects.toThrow(
        'Database error'
      );
      
      // Client should be released on error
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Query with Retry', () => {
    it('should retry on connection errors', async () => {
      let attempts = 0;
      (mockPool.query as any).mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Connection refused');
        }
        return { rows: [{ id: 1 }] };
      });

      const result = await query('SELECT 1');
      
      expect(attempts).toBe(3);
      expect(result.rows).toEqual([{ id: 1 }]);
    });

    it('should fail after max retries', async () => {
      (mockPool.query as any).mockRejectedValue(
        new Error('Connection refused')
      );

      await expect(query('SELECT 1')).rejects.toThrow('Connection refused');
      expect(mockPool.query).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-connection errors', async () => {
      (mockPool.query as any).mockRejectedValue(
        new Error('Syntax error in SQL')
      );

      await expect(query('INVALID SQL')).rejects.toThrow('Syntax error');
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('Row Locking with WHERE Conditions', () => {
    it('should acquire row lock with valid conditions', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'pending' }] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({}); // COMMIT

      const result = await withLock(
        'users',
        [{ column: 'id', operator: '=', value: 1 }],
        async (client, rows) => {
          return { locked: rows.length };
        }
      );

      expect(result).toEqual({ locked: 1 });
    });

    it('should reject invalid column names', async () => {
      await expect(
        withLock(
          'users',
          [{ column: 'id; DROP TABLE users;--', operator: '=', value: 1 }],
          async () => 'done'
        )
      ).rejects.toThrow('Invalid column name');
    });

    it('should reject invalid operators', async () => {
      await expect(
        withLock(
          'users',
          [{ column: 'id', operator: 'OR 1=1' as any, value: 1 }],
          async () => 'done'
        )
      ).rejects.toThrow('Invalid operator');
    });

    it('should require WHERE conditions for row locking', async () => {
      await expect(
        withLock('users', [], async () => 'done')
      ).rejects.toThrow('WHERE conditions are required');
    });

    it('should reject invalid table names', async () => {
      await expect(
        withLock(
          'invalid_table_name',
          [{ column: 'id', operator: '=', value: 1 }],
          async () => 'done'
        )
      ).rejects.toThrow('Invalid table name');
    });
  });

  describe('Batch Insert', () => {
    it('should insert records in batches', async () => {
      (mockPool.query as any).mockResolvedValue({});

      const records = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        name: `User ${i + 1}`,
      }));

      await batchInsert('users', records, 2);

      // Should be called 3 times: 2 + 2 + 1
      expect(mockPool.query).toHaveBeenCalledTimes(3);
    });

    it('should validate column names in batch insert', async () => {
      const records = [{ 'id; DROP TABLE users;--': 1 }];

      await expect(
        batchInsert('users', records)
      ).rejects.toThrow('Invalid column name');
    });

    it('should handle empty record array', async () => {
      await batchInsert('users', []);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should validate consistent columns across records', async () => {
      const records = [
        { id: 1, name: 'User 1' },
        { id: 2, email: 'user2@example.com' }, // Different columns
      ];

      await expect(
        batchInsert('users', records)
      ).rejects.toThrow('All records must have the same columns');
    });
  });
});
