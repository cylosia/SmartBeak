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
    project: './tsconfig.eslint.json',
    tsconfigRootDir: __dirname,
  },

  env: {
    es2022: true,
    node: true,
  },

  plugins: ['security'],

  rules: {
    'security/detect-eval-with-expression': 'error',
    'security/detect-unsafe-regex': 'error',          // ReDoS attacks
    'security/detect-child-process': 'error',          // command injection
    'security/detect-bidi-characters': 'error',        // trojan source attacks
    'security/detect-non-literal-require': 'warn',
    'security/detect-non-literal-fs-filename': 'warn',
    'security/detect-non-literal-regexp': 'warn',
    'security/detect-object-injection': 'warn',
    'security/detect-pseudoRandomBytes': 'warn',
    'security/detect-possible-timing-attacks': 'warn',
    'security/detect-no-csrf-before-method-override': 'warn',
    'security/detect-buffer-noassert': 'warn',
    'security/detect-disable-mustache-escape': 'warn',
    'security/detect-new-buffer': 'warn',
  },

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
    '*.d.ts',
    '!.eslintrc.cjs',
    '!.eslintrc.security.cjs',
  ],
};
