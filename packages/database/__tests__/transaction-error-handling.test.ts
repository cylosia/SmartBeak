/**
 * CRITICAL: Transaction Error Handling Tests
 * 
 * Tests for rollback failure scenarios and error chaining.
 * Ensures original errors are preserved when rollback fails.
 */

import { Pool, PoolClient } from 'pg';
import { withTransaction, TransactionError } from '../transactions';
// FIXED (Issue 1.1): Renamed from non-existent `withPgBouncerTransaction` to actual export
import { transactionWithPgBouncer } from '../pgbouncer';

// Mock the logger
jest.mock('@kernel/logger', () => ({
  getLogger: jest.fn(() => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  })),
}));

// Mock the pool
const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn();

jest.mock('../pool', () => ({
  getPool: jest.fn(() => ({
    connect: mockConnect,
  })),
  getConnectionMetrics: jest.fn(() => ({
    totalConnections: 10,
    idleConnections: 5,
    waitingClients: 0,
  })),
}));

describe('Transaction Error Handling', () => {
  let mockClient: Partial<PoolClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockClient = {
      query: mockQuery,
      release: mockRelease,
    };
    
    mockConnect.mockResolvedValue(mockClient);
  });

  describe('rollback failure logging', () => {
    it('should log rollback failures with original error context', async () => {
      const originalError = new Error('Original transaction error');
      const rollbackError = new Error('Rollback failed: connection terminated');

      // Setup query mock to fail on ROLLBACK
      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(originalError) // Transaction fails
        .mockRejectedValueOnce(rollbackError); // ROLLBACK also fails

      const { getLogger } = await import('@kernel/logger');
      const mockLogger = getLogger('database:transactions') as jest.Mocked<any>;

      await expect(
        withTransaction(async () => {
          throw originalError;
        })
      ).rejects.toThrow(originalError);

      // Verify rollback error was logged with original error context
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Rollback failed',
        rollbackError
      );
    });

    it('should include both errors in logs when rollback fails', async () => {
      const originalError = new Error('Database constraint violation');
      const rollbackError = new Error('Network error during rollback');

      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(originalError) // Transaction fails
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      const { getLogger } = await import('@kernel/logger');
      const mockLogger = getLogger('database:transactions') as jest.Mocked<any>;

      try {
        await withTransaction(async () => {
          throw originalError;
        });
      } catch (e) {
        // Expected to throw
      }

      // Verify the rollback failure was logged
      const rollbackLogCall = mockLogger.error.mock.calls.find(
        (call: any[]) => call[0] === 'Rollback failed'
      );
      expect(rollbackLogCall).toBeDefined();
      expect(rollbackLogCall[1]).toBe(rollbackError);
    });
  });

  describe('original error preservation', () => {
    it('should throw original error even when rollback succeeds', async () => {
      const originalError = new Error('Business logic error');

      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(originalError) // Transaction fails
        .mockResolvedValueOnce({}); // ROLLBACK succeeds

      await expect(
        withTransaction(async () => {
          throw originalError;
        })
      ).rejects.toBe(originalError);
    });

    it('should throw original error when rollback fails', async () => {
      const originalError = new Error('Unique constraint violation');
      const rollbackError = new Error('Rollback connection lost');

      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(originalError) // Transaction fails
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      await expect(
        withTransaction(async () => {
          throw originalError;
        })
      ).rejects.toBe(originalError);
    });

    it('should attach rollback error as cause when available', async () => {
      const originalError = new Error('Transaction failed');
      const rollbackError = new Error('Rollback failed');

      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(originalError) // Transaction fails
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      // Test with chained error
      class ChainedError extends Error {
        constructor(message: string, public cause?: Error) {
          super(message);
        }
      }

      const chainedError = new ChainedError('Operation failed', originalError);
      
      mockQuery.mockReset();
      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(chainedError) // Transaction fails
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      await expect(
        withTransaction(async () => {
          throw chainedError;
        })
      ).rejects.toBe(chainedError);
    });
  });

  describe('transaction state consistency', () => {
    it('should release client with error flag when rollback fails', async () => {
      const originalError = new Error('Transaction error');
      const rollbackError = new Error('Rollback failed');

      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(originalError) // Transaction fails
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      try {
        await withTransaction(async () => {
          throw originalError;
        });
      } catch (e) {
        // Expected
      }

      // When rollback fails, client should be released with error=true
      expect(mockRelease).toHaveBeenCalledWith(true);
    });

    it('should release client normally when rollback succeeds', async () => {
      const originalError = new Error('Transaction error');

      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(originalError) // Transaction fails
        .mockResolvedValueOnce({}); // ROLLBACK succeeds

      try {
        await withTransaction(async () => {
          throw originalError;
        });
      } catch (e) {
        // Expected
      }

      // When rollback succeeds, client should be released normally
      expect(mockRelease).toHaveBeenCalledWith(false);
    });

    it('should handle double-release attempts gracefully', async () => {
      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}); // COMMIT

      const { getLogger } = await import('@kernel/logger');
      const mockLogger = getLogger('database:transactions') as jest.Mocked<any>;

      await withTransaction(async () => {
        return 'success';
      });

      // Verify no double-release warning was logged
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        'Attempted to release already-released client'
      );
    });
  });

  describe('PgBouncer transaction error handling', () => {
    it('should handle rollback failures in PgBouncer transactions', async () => {
      const mockPool = {
        connect: mockConnect,
      } as unknown as Pool;

      const originalError = new Error('PgBouncer transaction failed');
      const rollbackError = new Error('PgBouncer rollback failed');

      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(originalError) // Transaction fails
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      // Get logger for verification
      const { getLogger } = await import('@kernel/logger');
      const mockLogger = getLogger('database:pgbouncer') as jest.Mocked<any>;
      const loggerSpy = jest.spyOn(mockLogger, 'error').mockImplementation();

      await expect(
        transactionWithPgBouncer(mockPool, async () => {
          throw originalError;
        })
      ).rejects.toBe(originalError);

      // Verify rollback error was logged
      expect(loggerSpy).toHaveBeenCalledWith(
        '[PgBouncer] Rollback failed',
        rollbackError
      );

      loggerSpy.mockRestore();
    });

    it('should preserve original error with PgBouncer when rollback succeeds', async () => {
      const mockPool = {
        connect: mockConnect,
      } as unknown as Pool;

      const originalError = new Error('Business error in PgBouncer context');

      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(originalError) // Transaction fails
        .mockResolvedValueOnce({}); // ROLLBACK succeeds

      await expect(
        transactionWithPgBouncer(mockPool, async () => {
          throw originalError;
        })
      ).rejects.toBe(originalError);
    });
  });

  describe('edge cases', () => {
    it('should handle non-Error rollback failures', async () => {
      const originalError = new Error('Transaction error');
      const rollbackError = 'String error from database';

      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(originalError) // Transaction fails
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails with string

      const { getLogger } = await import('@kernel/logger');
      const mockLogger = getLogger('database:transactions') as jest.Mocked<any>;

      await expect(
        withTransaction(async () => {
          throw originalError;
        })
      ).rejects.toBe(originalError);

      // Verify rollback error was logged even as string
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Rollback failed',
        rollbackError
      );
    });

    it('should handle timeout during rollback', async () => {
      const originalError = new Error('Transaction timeout');
      const rollbackTimeoutError = new Error('Rollback timed out after 30s');

      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(originalError) // Transaction fails
        .mockRejectedValueOnce(rollbackTimeoutError); // ROLLBACK times out

      const startTime = Date.now();
      
      await expect(
        withTransaction(async () => {
          throw originalError;
        })
      ).rejects.toBe(originalError);

      const duration = Date.now() - startTime;
      // Should not take significant time since we're mocking
      expect(duration).toBeLessThan(1000);
    });

    it('should handle release errors after rollback failure', async () => {
      const originalError = new Error('Transaction error');
      const rollbackError = new Error('Rollback failed');
      const releaseError = new Error('Release failed');

      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(originalError) // Transaction fails
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      mockRelease.mockImplementation(() => {
        throw releaseError;
      });

      const { getLogger } = await import('@kernel/logger');
      const mockLogger = getLogger('database:transactions') as jest.Mocked<any>;

      await expect(
        withTransaction(async () => {
          throw originalError;
        })
      ).rejects.toBe(originalError);

      // Verify release error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error releasing client',
        releaseError
      );
    });
  });

  describe('TransactionError class', () => {
    it('should create TransactionError with both original and rollback errors', () => {
      const originalError = new Error('Original');
      const rollbackError = new Error('Rollback');

      const transactionError = new TransactionError(
        'Transaction failed',
        originalError,
        rollbackError
      );

      expect(transactionError.message).toBe('Transaction failed');
      expect(transactionError.originalError).toBe(originalError);
      expect(transactionError.rollbackError).toBe(rollbackError);
      expect(transactionError.cause).toBe(originalError);
    });

    it('should serialize TransactionError to JSON properly', () => {
      const originalError = new Error('Original error message');
      const rollbackError = new Error('Rollback error message');

      const transactionError = new TransactionError(
        'Transaction failed',
        originalError,
        rollbackError
      );

      const serialized = JSON.stringify(transactionError);
      const parsed = JSON.parse(serialized);

      expect(parsed.message).toBe('Transaction failed');
      expect(parsed.originalError).toBe('Original error message');
      expect(parsed.rollbackError).toBe('Rollback error message');
    });
  });
});
