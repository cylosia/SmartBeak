
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

import { runMediaCanary } from '../../src/canaries/mediaCanaries';
import { emitMetric } from '../../src/ops/metrics';

const emitMetricMock = emitMetric as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runMediaCanary', () => {
  test('emits success metric on healthy check', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await runMediaCanary('youtube', fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(emitMetricMock).toHaveBeenCalledWith({
      name: 'media_canary_success',
      labels: { name: 'youtube' },
    });
  });

  test('emits failure metric and rethrows on error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('connection timeout'));

    await expect(runMediaCanary('youtube', fn)).rejects.toThrow('connection timeout');
    expect(emitMetricMock).toHaveBeenCalledWith({
      name: 'media_canary_failure',
      labels: { name: 'youtube' },
    });
  });

  test('passes adapter name correctly', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await runMediaCanary('instagram', fn);

    expect(emitMetricMock).toHaveBeenCalledWith({
      name: 'media_canary_success',
      labels: { name: 'instagram' },
    });
  });
});
