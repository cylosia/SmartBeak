/**
 * Performance Benchmark: Transaction Throughput
 *
 * Measures withTransaction() overhead and batch insert performance.
 * Asserts maximum acceptable latency to prevent regressions.
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
import { withTransaction } from '@database/transactions';

describe('Transaction Throughput Benchmarks', () => {
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
    vi.restoreAllMocks();
  });

  it('should complete 100 sequential transactions with < 5ms avg overhead', async () => {
    const ITERATIONS = 100;
    const MAX_AVG_MS = 5;

    const start = performance.now();

    for (let i = 0; i < ITERATIONS; i++) {
      await withTransaction(async (client) => {
        await client.query('SELECT 1');
        return { id: i };
      });
    }

    const elapsed = performance.now() - start;
    const avgMs = elapsed / ITERATIONS;

    expect(avgMs).toBeLessThan(MAX_AVG_MS);
  });

  it('should complete batch insert of 1000 rows in < 100ms total (mock DB)', async () => {
    const MAX_TOTAL_MS = 100;
    const BATCH_SIZE = 1000;

    const start = performance.now();

    await withTransaction(async (client) => {
      const values: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      for (let i = 0; i < BATCH_SIZE; i++) {
        values.push(`($${paramIdx++}, $${paramIdx++})`);
        params.push(`name-${i}`, `email-${i}@test.com`);
      }

      await client.query(
        `INSERT INTO users (name, email) VALUES ${values.join(',')}`,
        params
      );

      return { inserted: BATCH_SIZE };
    });

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(MAX_TOTAL_MS);
  });

  it('should have minimal overhead for transaction begin/commit cycle', async () => {
    const ITERATIONS = 200;
    const MAX_AVG_MS = 3;

    const start = performance.now();

    for (let i = 0; i < ITERATIONS; i++) {
      await withTransaction(async () => {
        // Empty transaction — measures pure framework overhead
        return null;
      });
    }

    const elapsed = performance.now() - start;
    const avgMs = elapsed / ITERATIONS;

    expect(avgMs).toBeLessThan(MAX_AVG_MS);
  });
});
