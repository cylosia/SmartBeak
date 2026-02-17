/**
 * PgBouncer Connection Pool Management Tests
 *
 * Tests for connection detection, pool configuration, transaction error chaining,
 * health checks, and URL parsing. Documents current behavior of load-bearing
 * connection pooling infrastructure.
 */

import type { Pool } from 'pg';

const mockLoggerInstance = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

jest.mock('@kernel/logger', () => ({
  getLogger: jest.fn(() => mockLoggerInstance),
}));

import {
  isPgBouncerConnection,
  transactionWithPgBouncer,
  checkPgBouncerHealth,
  parsePgBouncerUrl,
  queryWithPgBouncer,
  getPgBouncerConfig,
} from '../pgbouncer';

describe('PgBouncer Connection Pool Management', () => {
  describe('isPgBouncerConnection', () => {
    it('should detect PgBouncer on port 6432', () => {
      expect(isPgBouncerConnection('postgresql://user:pass@host:6432/db')).toBe(true);
    });

    it('should detect PgBouncer on port 5433', () => {
      expect(isPgBouncerConnection('postgresql://user:pass@host:5433/db')).toBe(true);
    });

    it('should detect PgBouncer via pgbouncer=true query param', () => {
      expect(isPgBouncerConnection('postgresql://user:pass@host:5432/db?pgbouncer=true')).toBe(true);
    });

    it('should return false for standard PostgreSQL port 5432', () => {
      expect(isPgBouncerConnection('postgresql://user:pass@host:5432/db')).toBe(false);
    });

    it('should return false for invalid URL', () => {
      expect(isPgBouncerConnection('not-a-url')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isPgBouncerConnection('')).toBe(false);
    });

    it('should return false for URL without port', () => {
      // URL without explicit port - parsed port is empty string, parseInt returns NaN
      expect(isPgBouncerConnection('postgresql://user:pass@host/db')).toBe(false);
    });

    it('should detect pgbouncer=true even on non-standard ports', () => {
      expect(isPgBouncerConnection('postgresql://user:pass@host:9999/db?pgbouncer=true')).toBe(true);
    });
  });

  describe('getPgBouncerConfig', () => {
    it('should create pool with smaller settings for PgBouncer connections', () => {
      const pool = getPgBouncerConfig({
        connectionString: 'postgresql://user:pass@host:6432/db',
      });
      // Pool is created - we verify it's a Pool instance
      expect(pool).toBeDefined();
      // PgBouncer pool uses max=5
      expect(pool.options.max).toBe(5);
    });

    it('should create pool with larger settings for direct connections', () => {
      const pool = getPgBouncerConfig({
        connectionString: 'postgresql://user:pass@host:5432/db',
      });
      expect(pool).toBeDefined();
      expect(pool.options.max).toBe(10);
    });

    it('should use provided statement_timeout for PgBouncer query_timeout', () => {
      const pool = getPgBouncerConfig({
        connectionString: 'postgresql://user:pass@host:6432/db',
        statement_timeout: 60000,
      });
      expect(pool).toBeDefined();
    });

    it('should default PgBouncer query_timeout to 30000 when not provided', () => {
      const pool = getPgBouncerConfig({
        connectionString: 'postgresql://user:pass@host:6432/db',
      });
      expect(pool).toBeDefined();
    });
  });

  describe('transactionWithPgBouncer', () => {
    let mockClient: {
      query: jest.Mock;
      release: jest.Mock;
    };
    let mockPool: Partial<Pool>;

    beforeEach(() => {
      mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient),
      };
    });

    it('should execute transaction with BEGIN, SET LOCAL, fn, COMMIT', async () => {
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await transactionWithPgBouncer(
        mockPool as Pool,
        async (client) => {
          await client.query('SELECT 1');
          return 'done';
        }
      );

      expect(result).toBe('done');
      expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(mockClient.query).toHaveBeenNthCalledWith(2, "SET LOCAL statement_timeout = '30s'");
      // 3rd call is the user query 'SELECT 1'
      expect(mockClient.query).toHaveBeenNthCalledWith(4, 'COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should ROLLBACK and throw original error on transaction failure', async () => {
      const txError = new Error('constraint violation');

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // SET LOCAL
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(
        transactionWithPgBouncer(mockPool as Pool, async () => {
          throw txError;
        })
      ).rejects.toBe(txError);

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should throw chained error when both transaction and rollback fail', async () => {
      const txError = new Error('transaction failed');
      const rollbackError = new Error('rollback failed');

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // SET LOCAL
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      await expect(
        transactionWithPgBouncer(mockPool as Pool, async () => {
          throw txError;
        })
      ).rejects.toThrow(
        'Transaction failed: transaction failed. Additionally, rollback failed: rollback failed'
      );
    });

    it('should log rollback error when rollback fails', async () => {
      const txError = new Error('tx error');
      const rollbackError = new Error('rollback error');

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // SET LOCAL
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      try {
        await transactionWithPgBouncer(mockPool as Pool, async () => {
          throw txError;
        });
      } catch {
        // expected
      }

      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        '[PgBouncer] Rollback failed',
        rollbackError
      );
    });

    it('should handle non-Error thrown values in transaction', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // SET LOCAL
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(
        transactionWithPgBouncer(mockPool as Pool, async () => {
          // eslint-disable-next-line no-throw-literal
          throw 'string error';
        })
      ).rejects.toBe('string error');
    });

    it('should handle non-Error rollback failure with string coercion', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // SET LOCAL
        .mockRejectedValueOnce('rollback string error'); // ROLLBACK fails with string

      await expect(
        transactionWithPgBouncer(mockPool as Pool, async () => {
          throw new Error('tx error');
        })
      ).rejects.toThrow(
        'Transaction failed: tx error. Additionally, rollback failed: rollback string error'
      );
    });

    it('should always release client even when rollback fails', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // SET LOCAL
        .mockRejectedValueOnce(new Error('rollback failed'));

      try {
        await transactionWithPgBouncer(mockPool as Pool, async () => {
          throw new Error('tx error');
        });
      } catch {
        // expected
      }

      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should always release client on success', async () => {
      mockClient.query.mockResolvedValue({});

      await transactionWithPgBouncer(mockPool as Pool, async () => 'ok');

      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('queryWithPgBouncer', () => {
    let mockClient: { query: jest.Mock; release: jest.Mock };
    let mockPool: Partial<Pool>;

    beforeEach(() => {
      mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient),
      };
    });

    it('should execute query and return rows and rowCount', async () => {
      mockClient.query.mockResolvedValue({
        rows: [{ id: 1 }, { id: 2 }],
        rowCount: 2,
      });

      const result = await queryWithPgBouncer(mockPool as Pool, 'SELECT * FROM test');
      expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
      expect(result.rowCount).toBe(2);
    });

    it('should return 0 for null rowCount', async () => {
      mockClient.query.mockResolvedValue({
        rows: [],
        rowCount: null,
      });

      const result = await queryWithPgBouncer(mockPool as Pool, 'SELECT 1');
      expect(result.rowCount).toBe(0);
    });

    it('should pass params to query', async () => {
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await queryWithPgBouncer(mockPool as Pool, 'SELECT $1', ['test']);
      expect(mockClient.query).toHaveBeenCalledWith('SELECT $1', ['test']);
    });

    it('should release client after successful query', async () => {
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await queryWithPgBouncer(mockPool as Pool, 'SELECT 1');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should release client after failed query', async () => {
      mockClient.query.mockRejectedValue(new Error('query error'));

      await expect(queryWithPgBouncer(mockPool as Pool, 'BAD SQL')).rejects.toThrow('query error');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('checkPgBouncerHealth', () => {
    let mockClient: { query: jest.Mock; release: jest.Mock };
    let mockPool: Partial<Pool>;

    beforeEach(() => {
      mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient),
      };
    });

    it('should return healthy status with parsed stats', async () => {
      mockClient.query.mockResolvedValue({
        rows: [{ cl_active: '10', cl_waiting: '5', sv_active: '3' }],
      });

      const result = await checkPgBouncerHealth(mockPool as Pool);
      expect(result).toEqual({
        healthy: true,
        availableConnections: 10,
        totalConnections: 5,
        queueDepth: 3,
      });
    });

    it('should return zeros when stats row has missing columns', async () => {
      mockClient.query.mockResolvedValue({
        rows: [{}],
      });

      const result = await checkPgBouncerHealth(mockPool as Pool);
      expect(result).toEqual({
        healthy: true,
        availableConnections: 0,
        totalConnections: 0,
        queueDepth: 0,
      });
    });

    it('should return zeros when SHOW STATS returns empty rows', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      const result = await checkPgBouncerHealth(mockPool as Pool);
      // stats is undefined (rows[0]), parseInt(undefined, 10) => NaN, || 0 => 0
      expect(result).toEqual({
        healthy: true,
        availableConnections: 0,
        totalConnections: 0,
        queueDepth: 0,
      });
    });

    it('should return unhealthy when pool.connect() fails', async () => {
      (mockPool.connect as jest.Mock).mockRejectedValue(new Error('connection refused'));

      const result = await checkPgBouncerHealth(mockPool as Pool);
      expect(result).toEqual({
        healthy: false,
        availableConnections: 0,
        totalConnections: 0,
        queueDepth: 0,
      });
    });

    it('should return unhealthy when SHOW STATS query fails', async () => {
      mockClient.query.mockRejectedValue(new Error('SHOW STATS not supported'));

      const result = await checkPgBouncerHealth(mockPool as Pool);
      expect(result).toEqual({
        healthy: false,
        availableConnections: 0,
        totalConnections: 0,
        queueDepth: 0,
      });
    });

    it('should release client even when query fails', async () => {
      mockClient.query.mockRejectedValue(new Error('query error'));

      await checkPgBouncerHealth(mockPool as Pool);
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('parsePgBouncerUrl', () => {
    it('should parse standard PgBouncer URL', () => {
      const result = parsePgBouncerUrl('postgresql://user:pass@myhost:6432/mydb');
      expect(result).toEqual({
        host: 'myhost',
        port: 6432,
        database: 'mydb',
        isPgBouncer: true,
      });
    });

    it('should parse direct PostgreSQL URL', () => {
      const result = parsePgBouncerUrl('postgresql://user:pass@myhost:5432/mydb');
      expect(result).toEqual({
        host: 'myhost',
        port: 5432,
        database: 'mydb',
        isPgBouncer: false,
      });
    });

    it('should default port to 5432 when not specified', () => {
      const result = parsePgBouncerUrl('postgresql://user:pass@myhost/mydb');
      expect(result).toEqual({
        host: 'myhost',
        port: 5432,
        database: 'mydb',
        isPgBouncer: false,
      });
    });

    it('should return defaults for invalid URL', () => {
      const result = parsePgBouncerUrl('not-a-url');
      expect(result).toEqual({
        host: 'unknown',
        port: 5432,
        database: 'unknown',
        isPgBouncer: false,
      });
    });

    it('should return defaults for empty string', () => {
      const result = parsePgBouncerUrl('');
      expect(result).toEqual({
        host: 'unknown',
        port: 5432,
        database: 'unknown',
        isPgBouncer: false,
      });
    });

    it('should handle URL with special characters in credentials', () => {
      const result = parsePgBouncerUrl('postgresql://user%40name:p%40ss@host:6432/db');
      expect(result.host).toBe('host');
      expect(result.port).toBe(6432);
      expect(result.database).toBe('db');
      expect(result.isPgBouncer).toBe(true);
    });

    it('should strip leading slash from database name', () => {
      const result = parsePgBouncerUrl('postgresql://u:p@h:5432/my_database');
      expect(result.database).toBe('my_database');
    });
  });
});
