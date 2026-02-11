
import { vi } from 'vitest';
import { GaAdapter } from '../../src/adapters/ga/GaAdapter';

vi.mock('@google-analytics/data', () => ({
  BetaAnalyticsDataClient: vi.fn().mockImplementation(() => ({
  runReport: vi.fn().mockResolvedValue([
    { rows: [{ metricValues: [{ value: '10' }] }] }
  ])
  }))
}));

test('GA adapter calls runReport and returns data', async () => {
  const adapter = new GaAdapter({});
  const res = await adapter.fetchMetrics('123', { dimensions: [], metrics: [] }) as { rows: any[] };
  expect(res.rows!.length).toBe(1);
});
