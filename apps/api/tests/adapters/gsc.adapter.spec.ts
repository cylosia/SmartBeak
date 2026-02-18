
// P1-16 FIX: The previous mock only stubbed google.searchconsole but NOT
// google.auth.OAuth2. GscAdapter's validateAuth() requires an .authorize method;
// passing {} failed construction before any assertion. Additionally the request
// body {} was missing required startDate/endDate, failing validateSearchAnalyticsRequest.

const mockQuery = jest.fn().mockResolvedValue({
  data: {
    rows: [
      {
        keys: ['test-keyword'],
        clicks: 5,
        impressions: 100,
        ctr: 0.05,
        position: 3.2,
      },
    ],
  },
});

jest.mock('googleapis', () => ({
  google: {
    auth: {
      // P1-16 FIX: mock OAuth2 so the GscAdapter constructor can initialise
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth'),
        getToken: jest.fn().mockResolvedValue({ tokens: { access_token: 'mock-token' } }),
        setCredentials: jest.fn(),
      })),
    },
    searchconsole: jest.fn().mockReturnValue({
      searchanalytics: {
        query: mockQuery,
      },
    }),
  },
}));

import { GscAdapter } from '../../src/adapters/gsc/GscAdapter';

describe('GSC adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns search analytics data with correct row shape', async () => {
    // P1-16 FIX: pass a mock auth object with .authorize so validateAuth() passes
    const mockAuth = { authorize: jest.fn() };
    const adapter = new GscAdapter(mockAuth as any);

    // P1-16 FIX: provide required startDate and endDate (validateSearchAnalyticsRequest
    // throws on empty body)
    const res = await adapter.fetchSearchAnalytics('https://example.com', {
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      dimensions: ['query'],
    }) as { rows?: Array<{ keys?: string[]; clicks?: number }> };

    expect(res.rows).toBeDefined();
    expect(res.rows?.[0]?.clicks).toBe(5);

    // Verify the adapter called the API with the correct site URL
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        siteUrl: 'https://example.com',
      }),
    );
  });
});
