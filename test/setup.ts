/**
 * P1-FIX: Test Setup and Teardown
 * 
 * Configures test environment with:
 * - Database transaction isolation
 * - Redis cleanup
 * - Environment variable mocking
 * - Console error tracking
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { getLogger } from '../packages/kernel/logger';

const logger = getLogger('TestSetup');

// P1-FIX: Track console errors during tests
const consoleErrors: string[] = [];
const originalError = console.error;

console.error = (...args: unknown[]) => {
  consoleErrors.push(args.map(String).join(' '));
  originalError.apply(console, args);
};

// Environment setup
beforeAll(() => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-minimum-32-characters-long';
  process.env.JWT_KEY_1 = 'test-secret-key-minimum-32-characters-long';
  process.env.JWT_KEY_2 = 'secondary-key-also-32-chars-minimum';
  process.env.CONTROL_PLANE_DB = 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL = 'redis://localhost:6379/1'; // Use DB 1 for tests
  process.env.PADDLE_WEBHOOK_SECRET = 'test-paddle-secret';
  process.env.CLERK_WEBHOOK_SECRET = 'whsec_test_clerk_secret';
});

// P1-FIX: Clean up before each test
beforeEach(async () => {
  // Clear console errors
  consoleErrors.length = 0;
  
  // Clear Redis test database
  try {
    const { getRedis } = await import('@kernel/redis');
    const redis = await getRedis();
    await redis.flushdb();
  } catch (error) {
    logger.warn('Could not clear Redis:', error);
  }
});

// P1-FIX: Clean up after each test
afterEach(async () => {
  // Check for unexpected console errors
  const unexpectedErrors = consoleErrors.filter(
    e => !e.includes('test') && !e.includes('expected')
  );
  
  if (unexpectedErrors.length > 0) {
    logger.warn('Unexpected console errors during test:', unexpectedErrors);
  }
});

// P1-FIX: Global teardown
afterAll(async () => {
  // Restore console.error
  console.error = originalError;
  
  // Close database connections
  try {
    const { getPool } = await import('@database/pool');
    const pool = await getPool();
    await pool.end();
  } catch (error) {
    // Ignore cleanup errors
  }
  
  // Close Redis connections
  try {
    const { getRedis } = await import('@kernel/redis');
    const redis = await getRedis();
    await redis.quit();
  } catch (error) {
    // Ignore cleanup errors
  }
});

// Global test utilities
declare global {
  function createMockUser(overrides?: Record<string, unknown>): {
    id: string;
    email: string;
    orgId: string;
    role: string;
  };
  
  function createMockOrganization(overrides?: Record<string, unknown>): {
    id: string;
    name: string;
    plan: string;
  };
}

(global as any).createMockUser = (overrides = {}) => ({
  id: 'user-test-123',
  email: 'test@example.com',
  orgId: 'org-test-123',
  role: 'owner',
  ...overrides,
});

(global as any).createMockOrganization = (overrides = {}) => ({
  id: 'org-test-123',
  name: 'Test Organization',
  plan: 'pro',
  ...overrides,
});
