
import { Pool } from 'pg';
import { UsageService } from './usage';

// P0-FIX: Type-safe mock using jest.Mocked utility type
// This approach avoids 'as unknown as' by using TypeScript's utility types
type MockedFunction<T extends (...args: unknown[]) => unknown> = jest.Mock<ReturnType<T>, Parameters<T>>;

interface MockPool extends Pool {
  query: MockedFunction<Pool['query']>;
  connect: MockedFunction<Pool['connect']>;
  end: MockedFunction<Pool['end']>;
  on: MockedFunction<Pool['on']>;
  removeListener: MockedFunction<Pool['removeListener']>;
}

/** Mock PostgreSQL pool for testing - P0-FIX: Type-safe mock without 'as unknown as' */
function createMockPool(): MockPool {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    connect: jest.fn(),
    end: jest.fn(),
    on: jest.fn().mockReturnThis(),
    removeListener: jest.fn().mockReturnThis(),
  } as MockPool;
}

describe('UsageService', () => {
  test('instantiates correctly', () => {
    const svc = new UsageService(createMockPool());
    expect(svc).toBeDefined();
  });

  describe('increment', () => {
    test('rejects invalid field names to prevent SQL injection', async () => {
      const svc = new UsageService(createMockPool());
      await expect(svc.increment('org-1', 'evil_field; DROP TABLE org_usage;--' as never))
        .rejects.toThrow('Invalid field');
    });

    test('rejects by=0 (no-op that wastes a DB round-trip and corrupts updated_at)', async () => {
      const svc = new UsageService(createMockPool());
      await expect(svc.increment('org-1', 'domain_count', 0))
        .rejects.toThrow('positive integer');
    });

    test('rejects negative increment values', async () => {
      const svc = new UsageService(createMockPool());
      await expect(svc.increment('org-1', 'domain_count', -1))
        .rejects.toThrow('positive integer');
    });

    test('rejects values exceeding PostgreSQL INTEGER max to prevent overflow', async () => {
      const svc = new UsageService(createMockPool());
      await expect(svc.increment('org-1', 'domain_count', 2_147_483_648))
        .rejects.toThrow('2,147,483,647');
    });

    test('rejects missing orgId', async () => {
      const svc = new UsageService(createMockPool());
      await expect(svc.increment('', 'domain_count'))
        .rejects.toThrow('Valid orgId is required');
    });

    test('calls ensureOrg then UPDATE on first call for a new org', async () => {
      const mockPool = createMockPool();
      const svc = new UsageService(mockPool);
      await svc.increment('org-new', 'domain_count');
      // First call: INSERT (ensureOrg) + UPDATE
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      const insertCall = (mockPool.query as jest.Mock).mock.calls[0] as [string, ...unknown[]];
      expect(insertCall[0]).toMatch(/INSERT INTO org_usage/i);
    });

    test('skips ensureOrg on subsequent calls for a known org', async () => {
      const mockPool = createMockPool();
      const svc = new UsageService(mockPool);
      await svc.increment('org-known', 'domain_count');
      (mockPool.query as jest.Mock).mockClear();
      await svc.increment('org-known', 'domain_count');
      // Second call: only UPDATE, no INSERT
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const call = (mockPool.query as jest.Mock).mock.calls[0] as [string, ...unknown[]];
      expect(call[0]).toMatch(/UPDATE org_usage/i);
    });

    test('cleans up pendingEnsureOrg after rejection so retry is possible', async () => {
      const mockPool = createMockPool();
      // First call fails during ensureOrg
      (mockPool.query as jest.Mock).mockRejectedValueOnce(new Error('DB error'));
      const svc = new UsageService(mockPool);

      await expect(svc.increment('org-retry', 'domain_count')).rejects.toThrow('DB error');

      // Second call should attempt ensureOrg again (not reuse the rejected promise)
      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 1 });
      await expect(svc.increment('org-retry', 'domain_count')).resolves.toBeDefined();
    });
  });

  describe('decrement', () => {
    test('rejects by=0', async () => {
      const svc = new UsageService(createMockPool());
      await expect(svc.decrement('org-1', 'domain_count', 0))
        .rejects.toThrow('positive integer');
    });

    test('uses GREATEST(0, ...) floor in SQL to prevent negative counters', async () => {
      const mockPool = createMockPool();
      const svc = new UsageService(mockPool);
      // Pre-warm the org cache
      await svc.increment('org-1', 'domain_count');
      (mockPool.query as jest.Mock).mockClear();
      await svc.decrement('org-1', 'domain_count', 5);
      const call = (mockPool.query as jest.Mock).mock.calls[0] as [string, ...unknown[]];
      expect(call[0]).toMatch(/GREATEST\(0,/i);
    });
  });

  describe('set', () => {
    test('rejects negative values', async () => {
      const svc = new UsageService(createMockPool());
      await expect(svc.set('org-1', 'domain_count', -1))
        .rejects.toThrow('non-negative integer');
    });

    test('rejects values exceeding PostgreSQL INTEGER max', async () => {
      const svc = new UsageService(createMockPool());
      await expect(svc.set('org-1', 'domain_count', 2_147_483_648))
        .rejects.toThrow('2,147,483,647');
    });
  });

  describe('getUsage', () => {
    test('returns default zeros for unknown org', async () => {
      const mockPool = createMockPool();
      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });
      const svc = new UsageService(mockPool);
      const result = await svc.getUsage('org-unknown');
      expect(result).toMatchObject({ org_id: 'org-unknown', domain_count: 0 });
    });

    test('returns the row when org exists', async () => {
      const mockPool = createMockPool();
      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [{ org_id: 'org-1', domain_count: 3, content_count: 10, media_count: 2, publish_count: 5 }],
      });
      const svc = new UsageService(mockPool);
      const result = await svc.getUsage('org-1');
      expect(result['domain_count']).toBe(3);
    });
  });
});
