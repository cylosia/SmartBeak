/**
 * P1-FIX: Jest Configuration for Testing
 *
 * Provides comprehensive test setup with:
 * - TypeScript support
 * - Coverage thresholds
 * - Parallel execution
 * - Test database setup
 * - Accessibility testing (a11y project)
 */

import type { Config } from 'jest';

const sharedTransform: Record<string, [string, Record<string, unknown>]> = {
  '^.+\\.tsx?$': ['ts-jest', {
    tsconfig: '<rootDir>/tsconfig.json',
    isolatedModules: true,
  }],
};

// P2-10 FIX: Added missing aliases that exist in tsconfig paths
const sharedModuleNameMapper = {
  '^@/(.*)$': '<rootDir>/$1',
  '^@kernel/(.*)$': '<rootDir>/packages/kernel/$1',
  '^@security/(.*)$': '<rootDir>/packages/security/$1',
  '^@database/(.*)$': '<rootDir>/packages/database/$1',
  '^@database$': '<rootDir>/packages/database/index.ts',
  '^@config$': '<rootDir>/packages/config/index.ts',
  '^@config/(.*)$': '<rootDir>/packages/config/$1',
  '^@errors$': '<rootDir>/packages/errors/index.ts',
  '^@monitoring$': '<rootDir>/packages/monitoring/index.ts',
  '^@monitoring/(.*)$': '<rootDir>/packages/monitoring/$1',
  '^@utils/(.*)$': '<rootDir>/packages/utils/$1',
  '^@types/(.*)$': '<rootDir>/packages/types/$1',
  '^@domain/(.*)$': '<rootDir>/domains/$1',
  '^@adapters/(.*)$': '<rootDir>/packages/adapters/$1',
  '^@packages/(.*)$': '<rootDir>/packages/$1',
  '^@shutdown$': '<rootDir>/packages/shutdown/index.ts',
};

const config: Config = {
  // P1-FIX: Parallel execution for faster tests
  maxWorkers: '50%',

  projects: [
    // Existing unit / integration tests
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: [
        '**/__tests__/**/*.test.ts',
        '**/tests/**/*.test.ts',
        '**/test/**/*.test.ts',
        '**/*.spec.ts',
      ],
      moduleNameMapper: sharedModuleNameMapper,
      setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
      transform: sharedTransform,
      // AUDIT-FIX P0: Comprehensive Vitest exclusion list.
      // All files below import from 'vitest' (vi.mock/vi.fn/vi.spyOn). Running
      // them under Jest produces vacuous passes: mocks are no-ops, assertions
      // execute against un-mocked production code or don't execute at all.
      // Previously only 5 of 58 Vitest files were excluded.
      testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/.next/',
        'test/a11y/',
        // -- Vitest-only top-level test directories --
        'test/benchmarks/',
        'test/chaos/',
        'test/load/',
        // -- packages/ Vitest tests --
        'packages/database/__tests__/transaction-error-handling.test.ts',
        'packages/database/__tests__/transactions.concurrency.test.ts',
        'packages/database/__tests__/transactions.test.ts',
        'packages/errors/__tests__/index.test.ts',
        'packages/kernel/__tests__/event-bus.test.ts',
        'packages/kernel/__tests__/rateLimiterRedis.test.ts',
        'packages/kernel/__tests__/redis.test.ts',
        'packages/kernel/__tests__/redlock.test.ts',
        'packages/kernel/__tests__/safe-handler.test.ts',
        'packages/monitoring/__tests__/performance-fixes.test.ts',
        'packages/security/__tests__/input-validator.test.ts',
        'packages/security/__tests__/jwt.test.ts',
        'packages/security/__tests__/session-binding.test.ts',
        'packages/security/__tests__/ssrf.test.ts',
        // -- control-plane/ Vitest tests --
        'control-plane/services/__tests__/auth.test.ts',
        'control-plane/services/__tests__/billing.test.ts',
        'control-plane/services/__tests__/jwt-signing.test.ts',
        'control-plane/services/__tests__/shard-generator.test.ts',
        'control-plane/adapters/affiliate/__tests__/amazon.test.ts',
        'control-plane/adapters/facebook/__tests__/FacebookAdapter.test.ts',
        // -- apps/api/ Vitest tests --
        'apps/api/src/adapters/__tests__/google-oauth.test.ts',
        'apps/api/src/adapters/wordpress/__tests__/WordPressAdapter.test.ts',
        'apps/api/src/billing/__tests__/paddle-webhook.test.ts',
        'apps/api/src/billing/__tests__/stripe.test.ts',
        'apps/api/src/domain/publishing/__tests__/WebPublishingAdapter.test.ts',
        'apps/api/src/email/__tests__/fallback.test.ts',
        'apps/api/src/jobs/__tests__/JobScheduler.test.ts',
        'apps/api/src/jobs/__tests__/JobScheduler.concurrency.test.ts',
        'apps/api/src/jobs/__tests__/worker.concurrency.test.ts',
        'apps/api/src/middleware/__tests__/abuseGuard.test.ts',
        'apps/api/src/middleware/__tests__/csrf.security.test.ts',
        'apps/api/src/middleware/__tests__/csrf.test.ts',
        'apps/api/src/routes/__tests__/bulkPublishCreate.test.ts',
        'apps/api/src/services/vault/__tests__/VaultClient.test.ts',
        'apps/api/src/utils/__tests__/resilience.concurrency.test.ts',
        // -- apps/web/ Vitest tests --
        'apps/web/pages/api/webhooks/__tests__/clerk.test.ts',
        // -- domains/ Vitest tests --
        'domains/customers/application/__tests__/CustomersService.test.ts',
        'domains/publishing/application/__tests__/PublishingService.test.ts',
        'domains/search/application/__tests__/SearchIndexingWorker.test.ts',
      ],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
      clearMocks: true,
      restoreMocks: true,
    },
    // Accessibility tests (jsdom, no DB/Redis setup)
    {
      displayName: 'a11y',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/test/a11y/**/*.test.tsx'],
      moduleNameMapper: sharedModuleNameMapper,
      transform: sharedTransform,
      testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.next/'],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
      clearMocks: true,
      restoreMocks: true,
    },
  ],

  // P3-D FIX: Removed redundant root-level moduleNameMapper and setupFilesAfterEnv.
  // When `projects` is defined, per-project settings override root-level settings.
  // Both the 'unit' and 'a11y' projects already define moduleNameMapper via
  // sharedModuleNameMapper. The root-level duplicates were dead config.

  // Coverage configuration
  collectCoverageFrom: [
    'apps/**/*.{ts,tsx}',
    'packages/**/*.{ts,tsx}',
    // control-plane contains all Fastify route handlers, auth middleware, and
    // billing logic. It was previously excluded so any broken change could ship
    // with a green coverage gate. domains/ holds DDD use-cases and repositories.
    'control-plane/**/*.{ts,tsx}',
    'domains/**/*.{ts,tsx}',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/*.d.ts',
  ],

  // P1-FIX: Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 80,
      statements: 80,
    },
    // Critical paths need higher coverage
    './apps/api/src/billing/**/*.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    './apps/api/src/jobs/**/*.ts': {
      branches: 80,
      functions: 80,
      lines: 85,
      statements: 85,
    },
    // control-plane route handlers, auth middleware, and billing must also
    // meet an enforced minimum floor (previously uncovered entirely).
    './control-plane/api/routes/**/*.ts': {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
    './control-plane/api/middleware/**/*.ts': {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
    // AUDIT-FIX H20: Security-critical JWT/auth code must have high coverage.
    // Previously fell under 70% global minimum — far below the 90% billing threshold.
    './packages/security/**/*.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    // AUDIT-FIX P2: control-plane JWT/auth services handle token signing,
    // revocation, and refresh. These are security-critical paths that must
    // meet the same threshold as packages/security.
    './control-plane/services/jwt.ts': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
    './control-plane/services/auth.ts': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },

  // Coverage reporters
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],

  // Test timeout (10 seconds default)
  testTimeout: 10000,

  // Verbose output for CI
  verbose: true,

  // Fail on console errors/warnings in tests
  errorOnDeprecated: true,
};

export default config;
