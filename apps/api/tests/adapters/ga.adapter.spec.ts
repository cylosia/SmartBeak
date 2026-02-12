
import { GaAdapter } from '../../src/adapters/ga/GaAdapter';

jest.mock('@google-analytics/data', () => ({
  BetaAnalyticsDataClient: jest.fn().mockImplementation(() => ({
  runReport: jest.fn().mockResolvedValue([
    { rows: [{ metricValues: [{ value: '10' }] }] }
  ])
  }))
}));

test('GA adapter calls runReport and returns data', async () => {
  const adapter = new GaAdapter({});
  const res = await adapter.fetchMetrics('123', { dimensions: [], metrics: [] }) as { rows: unknown[] };
  expect(res.rows).toBeDefined();
  expect(res.rows.length).toBe(1);
});
