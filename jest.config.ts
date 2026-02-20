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
      // The following test files use Vitest APIs (vi.mock/vi.fn/vi.spyOn) and are
      // covered by the Vitest config. Running them under Jest produces incorrect
      // results: mocks don't work and tests silently pass without exercising
      // production code. Exclude them here.
      // P1-FIX: Added the two JobScheduler Vitest tests that were missing from
      // this exclusion list (same root cause as rateLimiterRedis below).
      testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/.next/',
        'test/a11y/',
        'packages/kernel/__tests__/rateLimiterRedis.test.ts',
        'apps/api/src/jobs/__tests__/JobScheduler.test.ts',
        'apps/api/src/jobs/__tests__/JobScheduler.concurrency.test.ts',
        // P1-2 FIX: These files import `vi` from 'vitest'. Under Jest, vitest
        // APIs are undefined — mocks don't function and tests silently pass
        // without exercising production code.
        'control-plane/services/__tests__/jwt-signing.test.ts',
        'packages/security/__tests__/jwt.test.ts',
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
