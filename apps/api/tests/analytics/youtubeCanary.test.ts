/**
 * P1-4 FIX (audit 2): This test file previously tested runMediaCanary from
 * mediaCanaries.ts instead of the youtubeCanary function. Rewritten to test
 * the actual youtubeCanary function with all 4 code paths.
 */
import { vi, describe, test, expect, beforeEach } from 'vitest';

vi.mock('@kernel/logger', () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../../src/ops/metrics', () => ({
  emitMetric: vi.fn(),
}));

vi.mock('@config', () => ({
  DEFAULT_TIMEOUTS: { short: 5000, medium: 15000, long: 30000 },
}));

import { youtubeCanary } from '../../src/canaries/youtubeCanary';
import type { YouTubeAdapter } from '../../src/canaries/types';
import { emitMetric } from '../../src/ops/metrics';

const emitMetricMock = emitMetric as ReturnType<typeof vi.fn>;

function createMockAdapter(overrides: Partial<YouTubeAdapter> = {}): YouTubeAdapter {
  return {
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, latency: 42 }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
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
      healthCheck: vi.fn().mockResolvedValue({
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
      healthCheck: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    const result = await youtubeCanary(adapter);

    expect(result.name).toBe('youtube');
    expect(result.healthy).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
    expect(result.latency).toBeGreaterThanOrEqual(0);
  });

  test('returns unhealthy with "Unknown error" on non-Error throw', async () => {
    const adapter = createMockAdapter({
      healthCheck: vi.fn().mockRejectedValue('string error'),
    });
    const result = await youtubeCanary(adapter);

    expect(result.name).toBe('youtube');
    expect(result.healthy).toBe(false);
    expect(result.error).toBe('Unknown error');
  });

  test('uses default error message when healthCheck returns unhealthy without error string', async () => {
    const adapter = createMockAdapter({
      healthCheck: vi.fn().mockResolvedValue({
        healthy: false,
        latency: 50,
        // error property omitted
      }),
    });
    const result = await youtubeCanary(adapter);

    expect(result.healthy).toBe(false);
    expect(result.error).toContain('YouTube health check returned unhealthy');
  });

  // P1-4 FIX (audit 3): Test the canary timeout path — previously untested.
  // This exercises the Promise.race timeout when healthCheck hangs indefinitely.
  test('returns unhealthy with timeout error when healthCheck hangs (P1-4 audit 3)', async () => {
    vi.useFakeTimers();
    try {
      const adapter = createMockAdapter({
        // healthCheck never resolves — simulates a hanging adapter
        healthCheck: vi.fn().mockImplementation(() => new Promise(() => {})),
      });

      const resultPromise = youtubeCanary(adapter);

      // Advance past the CANARY_TIMEOUT_MS (mocked to 15000)
      await vi.advanceTimersByTimeAsync(15001);

      const result = await resultPromise;

      expect(result.name).toBe('youtube');
      expect(result.healthy).toBe(false);
      expect(result.error).toBe('YouTube canary timed out');
      expect(result.latency).toBeGreaterThanOrEqual(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
