
import { YouTubeAdapter } from '../../src/adapters/youtube/YouTubeAdapter';

// Properly mock node-fetch (not global.fetch) so the import is intercepted
jest.mock('node-fetch', () => {
  const fn = jest.fn();
  return { __esModule: true, default: fn };
});

// Properly mock abort-controller since it's no longer imported but just in case
jest.mock('../../src/utils/request', () => ({
  StructuredLogger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
  createRequestContext: jest.fn().mockReturnValue({ requestId: 'test-req-id' }),
  MetricsCollector: jest.fn().mockImplementation(() => ({
    recordLatency: jest.fn(),
    recordSuccess: jest.fn(),
    recordError: jest.fn(),
  })),
}));

jest.mock('../../src/utils/validation', () => ({
  validateNonEmptyString: jest.fn(),
}));

jest.mock('@config', () => ({
  API_BASE_URLS: { youtube: 'https://www.googleapis.com/youtube' },
  API_VERSIONS: { youtube: 'v3' },
  DEFAULT_TIMEOUTS: { short: 5000, long: 30000 },
}));

jest.mock('../../src/utils/retry', () => ({
  withRetry: jest.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fetchMock = require('node-fetch').default as jest.Mock;

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: {
      get: jest.fn().mockReturnValue(null),
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('YouTubeAdapter', () => {
  describe('constructor', () => {
    test('creates adapter with valid access token', () => {
      const adapter = new YouTubeAdapter('valid-token-123');
      expect(adapter).toBeDefined();
    });
  });

  describe('updateMetadata', () => {
    test('sends PUT request and returns parsed response', async () => {
      const responseBody = { id: 'vid123', snippet: { title: 'Updated Title' } };
      mockFetchResponse(responseBody);

      const adapter = new YouTubeAdapter('valid-token');
      const result = await adapter.updateMetadata('vid123', { title: 'Updated Title' });

      expect(result.id).toBe('vid123');
      expect(result.snippet?.title).toBe('Updated Title');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] = fetchMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(url).toContain('/videos?part=snippet');
      expect(options['method']).toBe('PUT');
      expect((options['headers'] as Record<string, string>)['Authorization']).toBe('Bearer valid-token');
    });

    test('throws ApiError on invalid response format', async () => {
      // Response missing 'id' field fails Zod validation
      mockFetchResponse({ error: 'some error' });

      const adapter = new YouTubeAdapter('valid-token');
      await expect(adapter.updateMetadata('vid123', { title: 'Test' }))
        .rejects.toThrow('Invalid response format from YouTube API');
    });

    test('throws on non-ok response', async () => {
      mockFetchResponse({ error: 'quota exceeded' }, false, 403);

      const adapter = new YouTubeAdapter('valid-token');
      await expect(adapter.updateMetadata('vid123', { title: 'Test' }))
        .rejects.toThrow('YouTube metadata update failed: 403');
    });
  });

  describe('getVideo', () => {
    test('returns first item from video list response', async () => {
      const responseBody = {
        items: [{ id: 'vid456', snippet: { title: 'My Video' }, status: { privacyStatus: 'public' } }],
      };
      mockFetchResponse(responseBody);

      const adapter = new YouTubeAdapter('valid-token');
      const result = await adapter.getVideo('vid456');

      expect(result.id).toBe('vid456');
      expect(result.snippet?.title).toBe('My Video');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('throws when video not found (empty items array)', async () => {
      mockFetchResponse({ items: [] });

      const adapter = new YouTubeAdapter('valid-token');
      await expect(adapter.getVideo('nonexistent'))
        .rejects.toThrow('Video not found: nonexistent');
    });

    test('throws on invalid response format', async () => {
      mockFetchResponse({ notItems: true });

      const adapter = new YouTubeAdapter('valid-token');
      await expect(adapter.getVideo('vid123'))
        .rejects.toThrow('Invalid response format from YouTube API');
    });
  });

  describe('healthCheck', () => {
    test('returns healthy when API responds 200', async () => {
      mockFetchResponse({ items: [] });

      const adapter = new YouTubeAdapter('valid-token');
      const result = await adapter.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.latency).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    test('returns unhealthy with auth error for 401', async () => {
      mockFetchResponse({}, false, 401);

      const adapter = new YouTubeAdapter('expired-token');
      const result = await adapter.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.error).toContain('authentication error');
      expect(result.error).toContain('401');
    });

    test('returns unhealthy with auth error for 403', async () => {
      mockFetchResponse({}, false, 403);

      const adapter = new YouTubeAdapter('forbidden-token');
      const result = await adapter.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.error).toContain('authentication error');
      expect(result.error).toContain('403');
    });

    test('returns unhealthy on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const adapter = new YouTubeAdapter('valid-token');
      const result = await adapter.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });
  });
});
