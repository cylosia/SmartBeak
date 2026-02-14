/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,

  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
    // P1-9 FIX: Enable type-aware linting for no-floating-promises rule
    project: './tsconfig.eslint.json',
  },

  env: {
    es2022: true,
    node: true,
  },

  plugins: ['@typescript-eslint', 'jsx-a11y'],

  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:jsx-a11y/recommended',
  ],

  rules: {
    // Downgrade pre-existing code issues to warnings for incremental adoption
    'no-irregular-whitespace': 'warn',
    'no-useless-escape': 'warn',
    'no-case-declarations': 'warn',
    'no-control-regex': 'warn',
    'no-unexpected-multiline': 'warn',
    'no-empty': 'warn',
    'no-useless-catch': 'warn',
    'no-extra-semi': 'warn',
    'prefer-const': 'warn',

    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    }],
    '@typescript-eslint/no-var-requires': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/ban-ts-comment': 'warn', // deprecated in v8; migrate to @typescript-eslint/ts-comment
    '@typescript-eslint/no-restricted-types': 'warn',
    '@typescript-eslint/no-namespace': 'warn',
    '@typescript-eslint/no-unnecessary-type-constraint': 'warn',

    // P1-9 FIX: Catch unhandled promise rejections and async-in-sync-callback bugs.
    // The codebase has manual "P0-FIX" comments for floating promise issues,
    // proving these bugs occur. These rules prevent new ones from being introduced.
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',

    // Accessibility: downgrade noisy rules to warn for incremental adoption
    'jsx-a11y/click-events-have-key-events': 'warn',
    'jsx-a11y/no-static-element-interactions': 'warn',
  },

  overrides: [
    {
      files: ['apps/web/**/*.{ts,tsx}'],
      env: {
        browser: true,
        node: false,
      },
    },
    {
      files: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/__tests__/**/*.ts',
        'test/**/*.ts',
        'test/**/*.tsx',
      ],
      env: {
        jest: true,
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    {
      files: ['**/*.d.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
  ],

  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    '.next/',
    'coverage/',
    'scripts/',
    '*.js',
    '*.mjs',
    '*.cjs',
    '!.eslintrc.cjs',
    '!.eslintrc.security.cjs',
  ],
};
