import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

// P1-FIX: __dirname is not available in ESM ("type": "module") without this shim.
// Using __dirname directly causes ReferenceError at runtime in Node ESM context.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    // P1-FIX: Exclude benchmark files from the normal test run.
    // Benchmarks are slow and I/O-heavy; running them as part of unit/integration
    // suites inflates CI time and produces flaky failures. Use `npm run test:bench`
    // to run benchmarks explicitly.
    include: ['**/*.{test,spec}.{ts,js}'],
    exclude: ['**/*.bench.{ts,js}', 'node_modules', 'dist', '.next'],
    // P1-FIX: Set a 10-second timeout so async tests that deadlock don't hang CI
    // indefinitely. Matches the timeout in jest.config.ts for consistency.
    testTimeout: 10000,
    // P2-FIX: Isolate module graph per file so module-scope globals (e.g. global.fetch)
    // set in one test file cannot bleed into other files sharing the same worker.
    isolate: true,
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/', 'test/', '**/*.d.ts', '**/*.bench.{ts,js}'],
      // P2-FIX: Enforce minimum coverage thresholds so drops are caught in CI.
      // Matches the global thresholds in jest.config.ts.
      thresholds: {
        lines: 80,
        functions: 70,
        branches: 70,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      '@kernel': path.resolve(__dirname, 'packages/kernel'),
      '@security': path.resolve(__dirname, 'packages/security'),
      '@database': path.resolve(__dirname, 'packages/database'),
      '@config': path.resolve(__dirname, 'packages/config'),
      '@errors': path.resolve(__dirname, 'packages/errors'),
      '@utils': path.resolve(__dirname, 'packages/utils'),
      '@types': path.resolve(__dirname, 'packages/types'),
      '@domain': path.resolve(__dirname, 'domains'),
      '@adapters': path.resolve(__dirname, 'packages/adapters'),
      '@packages': path.resolve(__dirname, 'packages'),
      '@shutdown': path.resolve(__dirname, 'packages/shutdown'),
      '@monitoring': path.resolve(__dirname, 'packages/monitoring'),
    },
  },
});
