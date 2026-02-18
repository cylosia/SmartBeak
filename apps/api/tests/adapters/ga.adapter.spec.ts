
import { GaAdapter } from '../../src/adapters/ga/GaAdapter';

// P2-18 FIX: The previous mock returned [{ rows: [...] }] — an array with one
// element — but GaAdapter destructures the runReport response as
// `const [response] = await runReport(...)`. The mock array was being used as
// the response object itself, so `res.rows.length` was checking the outer array
// length (1) rather than the inner rows array. Fixed: match the actual googleapis
// Data API v1 response shape where runReport resolves to [IRunReportResponse, ...].
jest.mock('@google-analytics/data', () => ({
  BetaAnalyticsDataClient: jest.fn().mockImplementation(() => ({
    runReport: jest.fn().mockResolvedValue([
      // First element is the response object (destructured by the adapter)
      {
        rows: [{ metricValues: [{ value: '10' }] }],
        rowCount: 1,
      },
    ]),
  })),
}));

describe('GA adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetchMetrics calls runReport and returns row data', async () => {
    const adapter = new GaAdapter({});
    const res = await adapter.fetchMetrics('123', { dimensions: [], metrics: [] }) as {
      rows: Array<{ metricValues: Array<{ value: string }> }>;
    };

    expect(res.rows).toBeDefined();
    // Assert the actual rows array length, not the outer response-tuple length
    expect(res.rows.length).toBe(1);
    expect(res.rows[0]?.metricValues[0]?.value).toBe('10');
  });
});
