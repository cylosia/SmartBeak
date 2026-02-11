import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.{test,spec}.{ts,js}'],
    exclude: ['node_modules', 'dist', '.next'],
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/', 'test/', '**/*.d.ts'],
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
      '@domain': path.resolve(__dirname, 'domains'),
      '@types': path.resolve(__dirname, 'packages/types'),
      '@packages': path.resolve(__dirname, 'packages'),
      '@utils': path.resolve(__dirname, 'packages/utils'),
      '@shutdown': path.resolve(__dirname, 'packages/shutdown'),
      '@middleware': path.resolve(__dirname, 'packages/middleware'),
      '@monitoring': path.resolve(__dirname, 'packages/monitoring'),
      '@cache': path.resolve(__dirname, 'packages/cache'),
      '@analytics': path.resolve(__dirname, 'packages/analytics'),
    },
  },
});
