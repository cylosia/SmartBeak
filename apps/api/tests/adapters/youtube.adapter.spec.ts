
import { vi, describe, test, expect, beforeEach } from 'vitest';

// Properly mock node-fetch (not global.fetch) so the import is intercepted
vi.mock('node-fetch', () => {
  const fn = vi.fn();
  return { __esModule: true, default: fn };
});

// Properly mock request utilities so the import is intercepted
vi.mock('../../src/utils/request', () => {
  class MockStructuredLogger {
    info = vi.fn();
    error = vi.fn();
    warn = vi.fn();
  }
  class MockMetricsCollector {
    recordLatency = vi.fn();
    recordSuccess = vi.fn();
    recordError = vi.fn();
  }
  return {
    StructuredLogger: MockStructuredLogger,
    createRequestContext: vi.fn().mockReturnValue({ requestId: 'test-req-id' }),
    MetricsCollector: MockMetricsCollector,
  };
});

vi.mock('../../src/utils/validation', () => ({
  validateNonEmptyString: vi.fn(),
}));

vi.mock('../../src/canaries/types', () => ({}));

vi.mock('@config', () => ({
  API_BASE_URLS: { youtube: 'https://www.googleapis.com/youtube' },
  API_VERSIONS: { youtube: 'v3' },
  DEFAULT_TIMEOUTS: { short: 5000, long: 30000 },
}));

vi.mock('../../src/utils/retry', () => ({
  withRetry: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
}));

import { YouTubeAdapter, ApiError } from '../../src/adapters/youtube/YouTubeAdapter';
import nodeFetch from 'node-fetch';

const fetchMock = nodeFetch as unknown as ReturnType<typeof vi.fn>;

function mockFetchResponse(body: unknown, ok = true, status = 200, headers?: Record<string, string | null>) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: {
      get: vi.fn().mockImplementation((name: string) => headers?.[name] ?? null),
    },
  });
}

/** Mock a response where .text() throws (P0-1 scenario) */
function mockFetchResponseWithBrokenBody(status: number) {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status,
    statusText: 'Error',
    json: async () => { throw new Error('body stream interrupted'); },
    text: async () => { throw new Error('body stream interrupted'); },
    headers: {
      get: vi.fn().mockReturnValue(null),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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

    // P0-1 FIX: Test that response.text() failure preserves the HTTP status
    test('preserves HTTP status when response body is unreadable (P0-1)', async () => {
      mockFetchResponseWithBrokenBody(403);

      const adapter = new YouTubeAdapter('valid-token');
      try {
        await adapter.updateMetadata('vid123', { title: 'Test' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(403);
      }
    });

    // P2-4: Test for 429 rate limiting with retry-after header
    test('throws ApiError with retryAfter on 429', async () => {
      mockFetchResponse({ error: 'rate limited' }, false, 429, { 'retry-after': '30' });

      const adapter = new YouTubeAdapter('valid-token');
      try {
        await adapter.updateMetadata('vid123', { title: 'Test' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(429);
        expect((error as ApiError).retryAfter).toBe('30');
      }
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
        .rejects.toThrow(/Video not found/);
    });

    test('throws on invalid response format', async () => {
      mockFetchResponse({ notItems: true });

      const adapter = new YouTubeAdapter('valid-token');
      await expect(adapter.getVideo('vid123'))
        .rejects.toThrow('Invalid response format from YouTube API');
    });

    // P1-6 FIX: Test parts allowlist validation
    test('throws on invalid part name (P1-6)', async () => {
      const adapter = new YouTubeAdapter('valid-token');
      await expect(adapter.getVideo('vid123', ['snippet', 'INVALID_PART']))
        .rejects.toThrow('Invalid YouTube API part: INVALID_PART');
    });

    test('accepts valid part names', async () => {
      const responseBody = {
        items: [{ id: 'vid456', snippet: { title: 'Video' } }],
      };
      mockFetchResponse(responseBody);

      const adapter = new YouTubeAdapter('valid-token');
      const result = await adapter.getVideo('vid456', ['snippet', 'contentDetails', 'statistics']);
      expect(result.id).toBe('vid456');
    });

    // P2-9 FIX (audit 2): Tests for getVideo error responses — previously missing
    test('throws ApiError on non-ok response (P2-9)', async () => {
      mockFetchResponse({ error: 'quota exceeded' }, false, 403);

      const adapter = new YouTubeAdapter('valid-token');
      try {
        await adapter.getVideo('vid123');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(403);
      }
    });

    test('throws ApiError with retryAfter on 429 (P2-9)', async () => {
      mockFetchResponse({ error: 'rate limited' }, false, 429, { 'retry-after': '60' });

      const adapter = new YouTubeAdapter('valid-token');
      try {
        await adapter.getVideo('vid123');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(429);
        expect((error as ApiError).retryAfter).toBe('60');
      }
    });

    // P1-1 FIX (audit 2): Verify response body is consumed in getVideo error path
    test('consumes response body on error to prevent connection leak (P1-1)', async () => {
      const textFn = vi.fn().mockResolvedValue('error body');
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({}),
        text: textFn,
        headers: { get: vi.fn().mockReturnValue(null) },
      });

      const adapter = new YouTubeAdapter('valid-token');
      await expect(adapter.getVideo('vid123')).rejects.toThrow();
      expect(textFn).toHaveBeenCalled();
    });

    test('preserves HTTP status when getVideo response body is unreadable (P1-1)', async () => {
      mockFetchResponseWithBrokenBody(500);

      const adapter = new YouTubeAdapter('valid-token');
      try {
        await adapter.getVideo('vid123');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(500);
      }
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

    // P2-7 FIX: 403 now differentiates between auth and quota errors
    test('returns 403 error with reason from response body', async () => {
      const errorBody = { error: { errors: [{ reason: 'quotaExceeded' }] } };
      mockFetchResponse(errorBody, false, 403);

      const adapter = new YouTubeAdapter('valid-token');
      const result = await adapter.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.error).toContain('403');
      expect(result.error).toContain('quotaExceeded');
    });

    test('returns 403 error with fallback reason when body is unparseable', async () => {
      mockFetchResponse('not json', false, 403);

      const adapter = new YouTubeAdapter('valid-token');
      const result = await adapter.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.error).toContain('403');
      expect(result.error).toContain('forbidden');
    });

    test('returns unhealthy on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const adapter = new YouTubeAdapter('valid-token');
      const result = await adapter.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    // P2-1: Verify response body is consumed (connection leak fix)
    test('consumes response body on success to prevent connection leak', async () => {
      const textFn = vi.fn().mockResolvedValue('{}');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: textFn,
        headers: { get: vi.fn().mockReturnValue(null) },
      });

      const adapter = new YouTubeAdapter('valid-token');
      await adapter.healthCheck();

      expect(textFn).toHaveBeenCalled();
    });
  });

  // P1-2 FIX (audit 2): Token factory pattern tests
  describe('token factory', () => {
    test('accepts a synchronous token factory function', async () => {
      const responseBody = { items: [{ id: 'vid789', snippet: { title: 'Test' } }] };
      mockFetchResponse(responseBody);

      const tokenFactory = vi.fn().mockReturnValue('dynamic-token');
      const adapter = new YouTubeAdapter(tokenFactory);
      const result = await adapter.getVideo('vid789');

      expect(result.id).toBe('vid789');
      expect(tokenFactory).toHaveBeenCalled();
      const [, options] = fetchMock.mock.calls[0] as [string, Record<string, unknown>];
      expect((options['headers'] as Record<string, string>)['Authorization']).toBe('Bearer dynamic-token');
    });

    test('accepts an async token factory function', async () => {
      const responseBody = { items: [{ id: 'vid789', snippet: { title: 'Test' } }] };
      mockFetchResponse(responseBody);

      const tokenFactory = vi.fn().mockResolvedValue('async-token');
      const adapter = new YouTubeAdapter(tokenFactory);
      const result = await adapter.getVideo('vid789');

      expect(result.id).toBe('vid789');
      const [, options] = fetchMock.mock.calls[0] as [string, Record<string, unknown>];
      expect((options['headers'] as Record<string, string>)['Authorization']).toBe('Bearer async-token');
    });

    // P3-9 FIX (audit 3): Test degenerate factory return values
    test('rejects empty string from token factory (P1-1 audit 3)', async () => {
      const { validateNonEmptyString: mockValidate } = await import('../../src/utils/validation');
      const mockFn = mockValidate as ReturnType<typeof vi.fn>;
      // First call: videoId validation (pass). Second call: accessToken validation (fail).
      mockFn.mockImplementationOnce(() => { /* videoId passes */ });
      mockFn.mockImplementationOnce(() => { throw new Error('accessToken cannot be empty'); });

      const tokenFactory = vi.fn().mockReturnValue('');
      const adapter = new YouTubeAdapter(tokenFactory);
      await expect(adapter.getVideo('vid123')).rejects.toThrow('accessToken cannot be empty');
    });

    test('propagates error when token factory throws (P3-9 audit 3)', async () => {
      const tokenFactory = vi.fn().mockRejectedValue(new Error('OAuth refresh failed'));
      const adapter = new YouTubeAdapter(tokenFactory);
      await expect(adapter.getVideo('vid123')).rejects.toThrow('OAuth refresh failed');
    });

    // P1-2 FIX (audit 3): Token is fetched inside retry, so factory is called on each attempt
    test('calls token factory on each retry attempt (P1-2 audit 3)', async () => {
      const { withRetry: mockRetry } = await import('../../src/utils/retry');
      const mockRetryFn = mockRetry as ReturnType<typeof vi.fn>;
      // Simulate 2 retry attempts: first fails, second succeeds
      let callCount = 0;
      mockRetryFn.mockImplementationOnce(async (fn: () => Promise<unknown>) => {
        try { callCount++; await fn(); } catch { /* first attempt fails */ }
        callCount++;
        return fn(); // second attempt succeeds
      });

      const responseBody = { items: [{ id: 'vid789', snippet: { title: 'Test' } }] };
      // First call returns error, second returns success
      mockFetchResponse({ error: 'temporary' }, false, 500);
      mockFetchResponse(responseBody);

      const tokenFactory = vi.fn().mockReturnValue('refreshed-token');
      const adapter = new YouTubeAdapter(tokenFactory);
      await adapter.getVideo('vid789');

      // Token factory should be called at least twice (once per retry attempt)
      expect(tokenFactory.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
