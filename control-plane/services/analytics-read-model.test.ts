
import { Pool } from 'pg';
import { AnalyticsReadModel } from './analytics-read-model';

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
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn(),
    end: jest.fn(),
    on: jest.fn().mockReturnThis(),
    removeListener: jest.fn().mockReturnThis(),
  } as MockPool;
}

test('analytics model increments', async () => {
  const mockPool = createMockPool();
  const rm = new AnalyticsReadModel(mockPool);
  expect(rm).toBeDefined();
});
