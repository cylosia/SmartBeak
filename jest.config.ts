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

const sharedModuleNameMapper = {
  '^@/(.*)$': '<rootDir>/$1',
  '^@kernel/(.*)$': '<rootDir>/packages/kernel/$1',
  '^@security/(.*)$': '<rootDir>/packages/security/$1',
  '^@database/(.*)$': '<rootDir>/packages/database/$1',
  '^@config$': '<rootDir>/packages/config/index.ts',
  // P2-1 FIX: Missing sub-path alias. Without this, any test in the unit/a11y
  // projects that imports @config/jobs, @config/env, etc. fails with module not found.
  '^@config/(.*)$': '<rootDir>/packages/config/$1',
  '^@errors$': '<rootDir>/packages/errors/index.ts',
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
      // P0-3 FIX: Vitest test files live in __tests__/ directories and import from
      // 'vitest', which Jest cannot resolve. They must be excluded from Jest's testMatch.
      // These files are intentionally run by Vitest (npm run test:load / test:chaos).
      testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/.next/',
        'test/a11y/',
        // Vitest files — import from 'vitest', incompatible with Jest
        'JobScheduler.concurrency.test.ts',
        'JobScheduler.test.ts',
        // packages/security jwt tests also import from vitest
        'packages/security/__tests__/jwt.test.ts',
        // control-plane jwt-signing test imports from vitest
        'control-plane/services/__tests__/jwt-signing.test.ts',
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

  
  // Module path mapping (match tsconfig)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@kernel/(.*)$': '<rootDir>/packages/kernel/$1',
    '^@security/(.*)$': '<rootDir>/packages/security/$1',
    '^@database/(.*)$': '<rootDir>/packages/database/$1',
    '^@config$': '<rootDir>/packages/config/index.ts',
    '^@config/(.*)$': '<rootDir>/packages/config/$1',
    '^@errors$': '<rootDir>/packages/errors/index.ts',
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  
  // Coverage configuration
  collectCoverageFrom: [
    'apps/**/*.{ts,tsx}',
    'packages/**/*.{ts,tsx}',
    // P2-2 FIX: control-plane and domains were missing from coverage.
    // The JWT signing service and all domain logic had zero coverage visibility.
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
