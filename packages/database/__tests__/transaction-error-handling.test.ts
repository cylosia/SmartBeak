/**
 * CRITICAL: Transaction Error Handling Tests
 * 
 * Tests for rollback failure scenarios and error chaining.
 * Ensures original errors are preserved when rollback fails.
 */

import { vi, type Mocked } from 'vitest';
import { Pool, PoolClient } from 'pg';
import { withTransaction, TransactionError } from '../transactions';
import { transactionWithPgBouncer } from '../pgbouncer';

// Mock the logger
vi.mock('@kernel/logger', () => ({
  getLogger: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock the pool
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn();

vi.mock('../pool', () => ({
  getPool: vi.fn(() => ({
    connect: mockConnect,
  })),
  getConnectionMetrics: vi.fn(() => ({
    totalConnections: 10,
    idleConnections: 5,
    waitingClients: 0,
  })),
}));

describe('Transaction Error Handling', () => {
  let mockClient: Partial<PoolClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    
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

      // Setup query mock: fn throws directly (no query), so ROLLBACK is 3rd query
      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      const { getLogger } = await import('@kernel/logger');
      const mockLogger = getLogger('database:transactions') as Mocked<any>;

      await expect(
        withTransaction(async () => {
          throw originalError;
        })
      ).rejects.toThrow(TransactionError);

      // Verify rollback error was logged with original error context
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Rollback failed - transaction may be in inconsistent state',
        expect.any(Error),
        expect.objectContaining({
          originalError: originalError.message,
        })
      );
    });

    it('should include both errors in logs when rollback fails', async () => {
      const originalError = new Error('Database constraint violation');
      const rollbackError = new Error('Network error during rollback');

      // fn throws directly (no query), so ROLLBACK is 3rd query
      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      const { getLogger } = await import('@kernel/logger');
      const mockLogger = getLogger('database:transactions') as Mocked<any>;

      try {
        await withTransaction(async () => {
          throw originalError;
        });
      } catch (e) {
        // Expected to throw
      }

      // Verify the rollback failure was logged
      const rollbackLogCall = mockLogger.error.mock.calls.find(
        (call: any[]) => call[0] === 'Rollback failed - transaction may be in inconsistent state'
      );
      expect(rollbackLogCall).toBeDefined();
      expect(rollbackLogCall![1]).toBeInstanceOf(Error);
      expect(rollbackLogCall![1].message).toBe(rollbackError.message);
    });
  });

  describe('original error preservation', () => {
    it('should throw original error even when rollback succeeds', async () => {
      const originalError = new Error('Business logic error');

      // fn throws directly (no query), so ROLLBACK is 3rd query
      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}); // ROLLBACK succeeds

      await expect(
        withTransaction(async () => {
          throw originalError;
        })
      ).rejects.toBe(originalError);
    });

    it('should throw TransactionError when rollback fails, preserving original error', async () => {
      const originalError = new Error('Unique constraint violation');
      const rollbackError = new Error('Rollback connection lost');

      // fn throws directly (no query), so ROLLBACK is 3rd query
      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      try {
        await withTransaction(async () => {
          throw originalError;
        });
        // Should not reach here
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(TransactionError);
        const txError = e as InstanceType<typeof TransactionError>;
        expect(txError.originalError.message).toBe(originalError.message);
        expect(txError.rollbackError?.message).toBe(rollbackError.message);
      }
    });

    it('should preserve chained error context in TransactionError when rollback fails', async () => {
      const originalError = new Error('Transaction failed');
      const rollbackError = new Error('Rollback failed');

      // Test with chained error
      class ChainedError extends Error {
        constructor(message: string, public cause?: Error) {
          super(message);
        }
      }

      const chainedError = new ChainedError('Operation failed', originalError);

      // fn throws directly (no query), so ROLLBACK is 3rd query
      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      try {
        await withTransaction(async () => {
          throw chainedError;
        });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(TransactionError);
        const txError = e as InstanceType<typeof TransactionError>;
        // The original error is preserved as originalError
        expect(txError.originalError).toBe(chainedError);
        expect(txError.rollbackError?.message).toBe(rollbackError.message);
      }
    });
  });

  describe('transaction state consistency', () => {
    it('should release client with error flag when rollback fails', async () => {
      const originalError = new Error('Transaction error');
      const rollbackError = new Error('Rollback failed');

      // fn throws directly (no query), so ROLLBACK is 3rd query
      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
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

      // fn throws directly (no query), so ROLLBACK is 3rd query
      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
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
      const mockLogger = getLogger('database:transactions') as Mocked<any>;

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

      // PgBouncer transaction order: BEGIN, SET LOCAL, then fn runs (throws),
      // then ROLLBACK in catch block
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // SET LOCAL statement_timeout
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      // Get logger for verification
      const { getLogger } = await import('@kernel/logger');
      const mockLogger = getLogger('database:pgbouncer') as Mocked<any>;
      const loggerSpy = vi.spyOn(mockLogger, 'error').mockImplementation();

      // transactionWithPgBouncer throws a new combined Error when rollback fails
      await expect(
        transactionWithPgBouncer(mockPool, async () => {
          throw originalError;
        })
      ).rejects.toThrow('Transaction failed');

      // Verify rollback error was logged
      expect(loggerSpy).toHaveBeenCalledWith(
        '[PgBouncer] Rollback failed',
        expect.objectContaining({ message: rollbackError.message })
      );

      loggerSpy.mockRestore();
    });

    it('should preserve original error with PgBouncer when rollback succeeds', async () => {
      const mockPool = {
        connect: mockConnect,
      } as unknown as Pool;

      const originalError = new Error('Business error in PgBouncer context');

      // PgBouncer transaction order: BEGIN, SET LOCAL, then fn runs (throws),
      // then ROLLBACK in catch block
      mockQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // SET LOCAL statement_timeout
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

      // fn throws directly (no query), so ROLLBACK is 3rd query
      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails with string

      const { getLogger } = await import('@kernel/logger');
      const mockLogger = getLogger('database:transactions') as Mocked<any>;

      // When rollback fails, a TransactionError is thrown
      await expect(
        withTransaction(async () => {
          throw originalError;
        })
      ).rejects.toThrow(TransactionError);

      // Verify rollback error was logged (string is wrapped in Error)
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Rollback failed - transaction may be in inconsistent state',
        expect.objectContaining({ message: rollbackError }),
        expect.objectContaining({
          originalError: originalError.message,
        })
      );
    });

    it('should handle timeout during rollback', async () => {
      const originalError = new Error('Transaction timeout');
      const rollbackTimeoutError = new Error('Rollback timed out after 30s');

      // fn throws directly (no query), so ROLLBACK is 3rd query
      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(rollbackTimeoutError); // ROLLBACK times out

      const startTime = Date.now();
      
      await expect(
        withTransaction(async () => {
          throw originalError;
        })
      ).rejects.toThrow(TransactionError);

      const duration = Date.now() - startTime;
      // Should not take significant time since we're mocking
      expect(duration).toBeLessThan(1000);
    });

    it('should handle release errors after rollback failure', async () => {
      const originalError = new Error('Transaction error');
      const rollbackError = new Error('Rollback failed');
      const releaseError = new Error('Release failed');

      // fn throws directly (no query), so ROLLBACK is 3rd query
      mockQuery
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(rollbackError); // ROLLBACK fails

      mockRelease.mockImplementation(() => {
        throw releaseError;
      });

      const { getLogger } = await import('@kernel/logger');
      const mockLogger = getLogger('database:transactions') as Mocked<any>;

      await expect(
        withTransaction(async () => {
          throw originalError;
        })
      ).rejects.toThrow(TransactionError);

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
      expect(transactionError.name).toBe('TransactionError');
      expect(transactionError.rootCause).toBe(originalError);
      expect(transactionError.hasRollbackFailure).toBe(true);
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
