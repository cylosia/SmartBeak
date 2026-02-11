/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  maxWorkers: '50%',
  
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/*.spec.ts',
  ],
  
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@kernel/(.*)$': '<rootDir>/packages/kernel/$1',
    '^@security/(.*)$': '<rootDir>/packages/security/$1',
    '^@database/(.*)$': '<rootDir>/packages/database/$1',
    '^@config$': '<rootDir>/packages/config/index.ts',
    '^@errors$': '<rootDir>/packages/errors/index.ts',
  },
  
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  
  collectCoverageFrom: [
    'apps/**/*.{ts,tsx}',
    'packages/**/*.{ts,tsx}',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/*.d.ts',
  ],
  
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 80,
      statements: 80,
    },
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
  
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],
  testTimeout: 10000,
  clearMocks: true,
  restoreMocks: true,
  verbose: true,
  errorOnDeprecated: true,
  
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.json',
    }],
  },
  
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/.next/',
  ],
  
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  
  globals: {
    'ts-jest': {
      isolatedModules: true,
    },
  },
};

module.exports = config;
