/**
 * P1-FIX: Jest Configuration for Testing
 * 
 * Provides comprehensive test setup with:
 * - TypeScript support
 * - Coverage thresholds
 * - Parallel execution
 * - Test database setup
 */

import type { Config } from 'jest';

const config: Config = {
  // Use ts-jest for TypeScript
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // P1-FIX: Parallel execution for faster tests
  maxWorkers: '50%',
  
  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/*.spec.ts',
  ],
  
  // Module path mapping (match tsconfig)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@kernel/(.*)$': '<rootDir>/packages/kernel/$1',
    '^@security/(.*)$': '<rootDir>/packages/security/$1',
    '^@database/(.*)$': '<rootDir>/packages/database/$1',
    '^@config$': '<rootDir>/packages/config/index.ts',
    '^@errors$': '<rootDir>/packages/errors/index.ts',
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  
  // Coverage configuration
  collectCoverageFrom: [
    'apps/**/*.{ts,tsx}',
    'packages/**/*.{ts,tsx}',
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
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Restore mocks after each test
  restoreMocks: true,
  
  // Verbose output for CI
  verbose: true,
  
  // Fail on console errors/warnings in tests
  errorOnDeprecated: true,
  
  // Transform settings
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.json',
    }],
  },
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/.next/',
  ],
  
  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  
  // Globals
  globals: {
    'ts-jest': {
      isolatedModules: true,
    },
  },
};

export default config;
