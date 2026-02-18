/**
 * P1-4 FIX (audit 2): This test file previously tested runMediaCanary from
 * mediaCanaries.ts instead of the youtubeCanary function. Rewritten to test
 * the actual youtubeCanary function with all 5 code paths (including timeout).
 *
 * P3-1 FIX (audit 4): Migrated from Vitest to Jest per CLAUDE.md convention
 * (Jest: unit + integration; Vitest: load, chaos, benchmarks).
 */
import { describe, test, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@kernel/logger', () => ({
  getLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  }),
}));

jest.mock('../../src/ops/metrics', () => ({
  emitMetric: jest.fn(),
}));

jest.mock('@config', () => ({
  DEFAULT_TIMEOUTS: { short: 5000, medium: 15000, long: 30000 },
}));

import { youtubeCanary } from '../../src/canaries/youtubeCanary';
import type { YouTubeAdapter } from '../../src/canaries/types';
import { emitMetric } from '../../src/ops/metrics';

const emitMetricMock = emitMetric as jest.Mock;

function createMockAdapter(overrides: Partial<YouTubeAdapter> = {}): YouTubeAdapter {
  return {
    healthCheck: jest.fn().mockResolvedValue({ healthy: true, latency: 42 }),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('youtubeCanary', () => {
  test('returns healthy result on successful health check', async () => {
    const adapter = createMockAdapter();
    const result = await youtubeCanary(adapter);

    expect(result.name).toBe('youtube');
    expect(result.healthy).toBe(true);
    expect(result.latency).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
    expect(adapter.healthCheck).toHaveBeenCalledTimes(1);
    expect(emitMetricMock).toHaveBeenCalledWith({
      name: 'media_canary_success',
      labels: { name: 'youtube' },
    });
  });

  test('returns unhealthy result when healthCheck reports unhealthy', async () => {
    const adapter = createMockAdapter({
      healthCheck: jest.fn().mockResolvedValue({
        healthy: false,
        latency: 100,
        error: 'quota exceeded',
      }),
    });
    const result = await youtubeCanary(adapter);

    expect(result.name).toBe('youtube');
    expect(result.healthy).toBe(false);
    expect(result.error).toBeDefined();
    expect(emitMetricMock).toHaveBeenCalledWith({
      name: 'media_canary_failure',
      labels: { name: 'youtube' },
    });
  });

  test('returns unhealthy result when healthCheck throws Error', async () => {
    const adapter = createMockAdapter({
      healthCheck: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    const result = await youtubeCanary(adapter);

    expect(result.name).toBe('youtube');
    expect(result.healthy).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
    expect(result.latency).toBeGreaterThanOrEqual(0);
  });

  test('returns unhealthy with "Unknown error" on non-Error throw', async () => {
    const adapter = createMockAdapter({
      healthCheck: jest.fn().mockRejectedValue('string error'),
    });
    const result = await youtubeCanary(adapter);

    expect(result.name).toBe('youtube');
    expect(result.healthy).toBe(false);
    expect(result.error).toBe('Unknown error');
  });

  test('uses default error message when healthCheck returns unhealthy without error string', async () => {
    const adapter = createMockAdapter({
      healthCheck: jest.fn().mockResolvedValue({
        healthy: false,
        latency: 50,
        // error property omitted
      }),
    });
    const result = await youtubeCanary(adapter);

    expect(result.healthy).toBe(false);
    expect(result.error).toContain('YouTube health check returned unhealthy');
  });

  // P1-4 FIX (audit 3) / P3-1 FIX (audit 4): Test the canary timeout path.
  // Migrated from vi.useFakeTimers() / vi.advanceTimersByTimeAsync() to Jest
  // equivalents. jest.advanceTimersByTime() fires the setTimeout synchronously;
  // `await resultPromise` then flushes the microtask queue so the catch block
  // in youtubeCanary processes the rejection and returns the unhealthy result.
  test('returns unhealthy with timeout error when healthCheck hangs', async () => {
    jest.useFakeTimers();
    try {
      const adapter = createMockAdapter({
        // healthCheck never resolves — simulates a hanging adapter
        healthCheck: jest.fn().mockImplementation(() => new Promise(() => {})),
      });

      const resultPromise = youtubeCanary(adapter);

      // Advance past CANARY_TIMEOUT_MS (mocked to 15000 ms)
      jest.advanceTimersByTime(15001);

      // Awaiting flushes the microtask queue so the catch block runs
      const result = await resultPromise;

      expect(result.name).toBe('youtube');
      expect(result.healthy).toBe(false);
      expect(result.error).toBe('YouTube canary timed out');
      expect(result.latency).toBeGreaterThanOrEqual(0);
    } finally {
      jest.useRealTimers();
    }
  });

  // P2-7 FIX (audit 4): When the canary timeout fires, the AbortController
  // is aborted before the race rejects. Verify that healthCheck was called
  // with an AbortSignal (the adapter now receives the signal from youtubeCanary).
  test('passes AbortSignal to healthCheck so it can be cancelled on timeout', async () => {
    const healthCheckMock = jest.fn().mockResolvedValue({ healthy: true, latency: 10 });
    const adapter = createMockAdapter({ healthCheck: healthCheckMock });

    await youtubeCanary(adapter);

    // healthCheck must be called with an AbortSignal argument
    expect(healthCheckMock).toHaveBeenCalledTimes(1);
    const [signal] = healthCheckMock.mock.calls[0] as [AbortSignal | undefined];
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
