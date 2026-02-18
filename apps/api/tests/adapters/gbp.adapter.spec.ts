
// P1-15 FIX: googleapis was not mocked. GbpAdapter.createPost() calls the real
// mybusiness googleapis client, making real HTTPS requests to Google in CI.
// This caused flaky tests (network timeouts) and potential real API side-effects.
const mockLocalPostsCreate = jest.fn().mockResolvedValue({
  data: {
    name: 'accounts/123456789/locations/location123/localPosts/post-abc123',
    state: 'LIVE',
    searchUrl: 'https://search.google.com/local/posts?q=test',
  },
});

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth'),
        getToken: jest.fn().mockResolvedValue({
          tokens: { access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', expiry_date: Date.now() + 3600000 },
        }),
        setCredentials: jest.fn(),
      })),
    },
    // mybusiness must be present for hasMyBusiness() check in GbpAdapter
    mybusiness: jest.fn().mockReturnValue({
      accounts: {
        locations: {
          localPosts: { create: mockLocalPostsCreate },
        },
      },
    }),
    mybusinessbusinessinformation: jest.fn().mockReturnValue({}),
    mybusinessnotifications: jest.fn().mockReturnValue({}),
  },
}));

import { GbpAdapter } from '../../src/adapters/gbp/GbpAdapter';

describe('GBP adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates a post without making real network calls', async () => {
    const adapter = new GbpAdapter({ clientId: 'test-client-id', clientSecret: 'test-client-secret' });

    const res = await adapter.createPost('location123', {
      summary: 'Test post content for unit test purposes',
      languageCode: 'en-US',
    });

    // Assert response fields are mapped correctly
    expect(res.state).toBe('LIVE');
    expect(res.name).toBeDefined();

    // Assert the API was actually called with the expected location parent
    expect(mockLocalPostsCreate).toHaveBeenCalledTimes(1);
    expect(mockLocalPostsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: expect.stringContaining('location123'),
      }),
    );
  });
});
