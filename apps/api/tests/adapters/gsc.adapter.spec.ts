
import { vi } from 'vitest';
import { GscAdapter } from '../../src/adapters/gsc/GscAdapter';

vi.mock('googleapis', () => ({
  google: {
  searchconsole: vi.fn().mockReturnValue({
    searchanalytics: {
    query: vi.fn().mockResolvedValue({
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
