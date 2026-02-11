
import { GscAdapter } from '../../src/adapters/gsc/GscAdapter';

jest.mock('googleapis', () => ({
  google: {
  searchconsole: jest.fn().mockReturnValue({
    searchanalytics: {
    query: jest.fn().mockResolvedValue({
    data: { rows: [{ clicks: 5 }] }
    })
    }
  })
  }
}));

test('GSC adapter returns search analytics data', async () => {
  const adapter = new GscAdapter({});
  const res = await adapter.fetchSearchAnalytics('https://example.com', {}) as { rows?: any[] };
  expect(res.rows?.[0]?.clicks).toBe(5);
});
