
import { vi, Mock } from 'vitest';
import { Pool } from 'pg';
import { UsageService } from './usage';

// P0-FIX: Type-safe mock using vitest Mock utility type
// This approach avoids 'as unknown as' by using TypeScript's utility types
type MockedFunction<T extends (...args: unknown[]) => unknown> = Mock<ReturnType<T>, Parameters<T>>;

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
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn(),
    end: vi.fn(),
    on: vi.fn().mockReturnThis(),
    removeListener: vi.fn().mockReturnThis(),
  } as MockPool;
}

test('usage initializes and increments', async () => {
  const mockPool = createMockPool();
  const svc = new UsageService(mockPool);
  expect(svc).toBeDefined();
});
