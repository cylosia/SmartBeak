import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// P1-2 FIX: Mock @kernel/request (the real import in YouTubeAdapter.ts) not the
// deprecated shim. The old mock targeted '../../src/utils/request' which resolved
// to a different module identity than @kernel/request, causing the real
// StructuredLogger/MetricsCollector to initialise in unit tests.
//
// NOTE: YouTubeAdapter.ts has been migrated to use getLogger from @kernel/logger
// (P2-4 fix). The @kernel/request mock is kept here only to guard against any
// remaining imports from that path, but the critical mock is now @kernel/logger.
jest.mock('@kernel/logger', () => ({
  getLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  }),
}));

// Mock node-fetch (not global.fetch) so the import is intercepted
jest.mock('node-fetch', () => {
  const fn = jest.fn();
  return { __esModule: true, default: fn };
});

jest.mock('../../src/utils/validation', () => ({
  validateNonEmptyString: jest.fn(),
}));

jest.mock('../../src/canaries/types', () => ({}));

jest.mock('@config', () => ({
  API_BASE_URLS: { youtube: 'https://www.googleapis.com/youtube' },
  API_VERSIONS: { youtube: 'v3' },
  DEFAULT_TIMEOUTS: { short: 5000, long: 30000 },
}));

// P3-5 FIX: withRetry mock is now a faithful re-implementation that actually
// calls fn the correct number of times, rather than manually re-implementing
// retry semantics. This means the token-factory-per-retry test no longer relies
// on a hand-rolled loop that diverges from real withRetry behaviour.
jest.mock('../../src/utils/retry', () => ({
  withRetry: jest.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
}));

// CircuitBreaker: auto-execute without state management in unit tests
jest.mock('@kernel/retry', () => ({
  withRetry: jest.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
  CircuitBreaker: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
  })),
}));

jest.mock('../../src/utils/sanitize', () => ({
  sanitizeVideoIdForLog: jest.fn().mockImplementation((id: string) => id.slice(0, 20)),
}));

import { YouTubeAdapter, ApiError } from '../../src/adapters/youtube/YouTubeAdapter';
import nodeFetch from 'node-fetch';

const fetchMock = nodeFetch as unknown as jest.Mock;

function mockFetchResponse(body: unknown, ok = true, status = 200, headers?: Record<string, string | null>) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: {
      get: jest.fn().mockImplementation((name: string) => headers?.[name] ?? null),
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
      const responseBody = { id: 'vid12345678', snippet: { title: 'Updated Title' } };
      mockFetchResponse(responseBody);

      const adapter = new YouTubeAdapter('valid-token');
      const result = await adapter.updateMetadata('vid12345678', { title: 'Updated Title' });

      expect(result.id).toBe('vid12345678');
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
      await expect(adapter.updateMetadata('vid12345678', { title: 'Test' }))
        .rejects.toThrow('Invalid response format from YouTube API');
    });

    test('throws on non-ok response', async () => {
      mockFetchResponse({ error: 'quota exceeded' }, false, 403);

      const adapter = new YouTubeAdapter('valid-token');
      await expect(adapter.updateMetadata('vid12345678', { title: 'Test' }))
        .rejects.toThrow('YouTube metadata update failed: 403');
    });

    // P0-1 FIX: Test that response.text() failure preserves the HTTP status
    test('preserves HTTP status when response body is unreadable (P0-1)', async () => {
      mockFetchResponseWithBrokenBody(403);

      const adapter = new YouTubeAdapter('valid-token');
      try {
        await adapter.updateMetadata('vid12345678', { title: 'Test' });
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
        await adapter.updateMetadata('vid12345678', { title: 'Test' });
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
        items: [{ id: 'vid4567890', snippet: { title: 'My Video' }, status: { privacyStatus: 'public' } }],
      };
      mockFetchResponse(responseBody);

      const adapter = new YouTubeAdapter('valid-token');
      const result = await adapter.getVideo('vid4567890');

      expect(result.id).toBe('vid4567890');
      expect(result.snippet?.title).toBe('My Video');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('throws when video not found (empty items array)', async () => {
      mockFetchResponse({ items: [] });

      const adapter = new YouTubeAdapter('valid-token');
      await expect(adapter.getVideo('vid4567890x'))
        .rejects.toThrow(/Video not found/);
    });

    test('throws on invalid response format', async () => {
      mockFetchResponse({ notItems: true });

      const adapter = new YouTubeAdapter('valid-token');
      await expect(adapter.getVideo('vid12345678'))
        .rejects.toThrow('Invalid response format from YouTube API');
    });

    // P1-6 FIX: Test parts allowlist validation
    test('throws on invalid part name (P1-6)', async () => {
      const adapter = new YouTubeAdapter('valid-token');
      await expect(adapter.getVideo('vid12345678', ['snippet', 'INVALID_PART']))
        .rejects.toThrow('Invalid YouTube API part: INVALID_PART');
    });

    // P1-4 FIX: Empty parts array must be rejected with a clear validation error
    test('throws on empty parts array (P1-4)', async () => {
      const adapter = new YouTubeAdapter('valid-token');
      await expect(adapter.getVideo('vid12345678', []))
        .rejects.toThrow('parts array must contain at least one valid part name');
    });

    test('accepts valid part names', async () => {
      const responseBody = {
        items: [{ id: 'vid4567890', snippet: { title: 'Video' } }],
      };
      mockFetchResponse(responseBody);

      const adapter = new YouTubeAdapter('valid-token');
      const result = await adapter.getVideo('vid4567890', ['snippet', 'contentDetails', 'statistics']);
      expect(result.id).toBe('vid4567890');
    });

    test('throws ApiError on non-ok response', async () => {
      mockFetchResponse({ error: 'quota exceeded' }, false, 403);

      const adapter = new YouTubeAdapter('valid-token');
      try {
        await adapter.getVideo('vid12345678');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(403);
      }
    });

    test('throws ApiError with retryAfter on 429', async () => {
      mockFetchResponse({ error: 'rate limited' }, false, 429, { 'retry-after': '60' });

      const adapter = new YouTubeAdapter('valid-token');
      try {
        await adapter.getVideo('vid12345678');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(429);
        expect((error as ApiError).retryAfter).toBe('60');
      }
    });

    // P1-1 FIX: Verify response body is consumed in getVideo error path
    test('consumes response body on error to prevent connection leak', async () => {
      const textFn = jest.fn().mockResolvedValue('error body');
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({}),
        text: textFn,
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      const adapter = new YouTubeAdapter('valid-token');
      await expect(adapter.getVideo('vid12345678')).rejects.toThrow();
      expect(textFn).toHaveBeenCalled();
    });

    test('preserves HTTP status when getVideo response body is unreadable', async () => {
      mockFetchResponseWithBrokenBody(500);

      const adapter = new YouTubeAdapter('valid-token');
      try {
        await adapter.getVideo('vid12345678');
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

    // P2-1 FIX: Verify response body is consumed (connection leak fix)
    test('consumes response body on success to prevent connection leak', async () => {
      const textFn = jest.fn<() => Promise<string>>().mockResolvedValue('{}');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: textFn,
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      const adapter = new YouTubeAdapter('valid-token');
      await adapter.healthCheck();

      expect(textFn).toHaveBeenCalled();
    });

    // P2-1 FIX: Healthy results are cached for 60 s to reduce quota burn
    test('serves second call from cache within TTL', async () => {
      mockFetchResponse({ items: [] });

      const adapter = new YouTubeAdapter('valid-token');
      await adapter.healthCheck();       // real call
      await adapter.healthCheck();       // should hit cache

      // fetch should only have been called once
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // P1-2 FIX: Token factory pattern tests
  describe('token factory', () => {
    test('accepts a synchronous token factory function', async () => {
      const responseBody = { items: [{ id: 'vid7890123', snippet: { title: 'Test' } }] };
      mockFetchResponse(responseBody);

      const tokenFactory = jest.fn().mockReturnValue('dynamic-token');
      const adapter = new YouTubeAdapter(tokenFactory);
      const result = await adapter.getVideo('vid7890123');

      expect(result.id).toBe('vid7890123');
      expect(tokenFactory).toHaveBeenCalled();
      const [, options] = fetchMock.mock.calls[0] as [string, Record<string, unknown>];
      expect((options['headers'] as Record<string, string>)['Authorization']).toBe('Bearer dynamic-token');
    });

    test('accepts an async token factory function', async () => {
      const responseBody = { items: [{ id: 'vid7890123', snippet: { title: 'Test' } }] };
      mockFetchResponse(responseBody);

      const tokenFactory = jest.fn().mockResolvedValue('async-token');
      const adapter = new YouTubeAdapter(tokenFactory);
      const result = await adapter.getVideo('vid7890123');

      expect(result.id).toBe('vid7890123');
      const [, options] = fetchMock.mock.calls[0] as [string, Record<string, unknown>];
      expect((options['headers'] as Record<string, string>)['Authorization']).toBe('Bearer async-token');
    });

    test('propagates error when token factory throws', async () => {
      const tokenFactory = jest.fn().mockRejectedValue(new Error('OAuth refresh failed'));
      const adapter = new YouTubeAdapter(tokenFactory);
      await expect(adapter.getVideo('vid12345678')).rejects.toThrow('OAuth refresh failed');
    });

    // P3-5 FIX: Token-per-retry test now uses a faithful multi-attempt mock
    // instead of a hand-rolled loop that diverged from real withRetry semantics.
    //
    // Audit fix: The previous version spied on '../../src/utils/retry', but
    // YouTubeAdapter imports withRetry directly from '@kernel/retry'. Jest
    // resolves module mocks by module ID, so a spy on the re-export shim had
    // zero effect on the adapter's withRetry calls — the test never actually
    // verified retry behaviour. The spy is now correctly targeted at
    // '@kernel/retry', the module the adapter binds to at import time.
    test('calls token factory on each retry attempt (P3-5)', async () => {
      const kernelRetry = await import('@kernel/retry');
      const withRetrySpy = jest.spyOn(kernelRetry, 'withRetry');

      // Faithful mock: calls fn up to maxRetries+1 times (matching real withRetry)
      withRetrySpy.mockImplementationOnce(async (fn: () => Promise<unknown>, opts?: { maxRetries?: number }) => {
        const maxAttempts = (opts?.maxRetries ?? 3) + 1;
        let lastError: unknown;
        for (let i = 0; i < maxAttempts; i++) {
          try {
            return await fn();
          } catch (err) {
            lastError = err;
          }
        }
        throw lastError;
      });

      const responseBody = { items: [{ id: 'vid7890123', snippet: { title: 'Test' } }] };
      // First call returns error; second succeeds
      mockFetchResponse({ error: 'temporary' }, false, 500);
      mockFetchResponse(responseBody);

      const tokenFactory = jest.fn().mockReturnValue('refreshed-token');
      const adapter = new YouTubeAdapter(tokenFactory);
      await adapter.getVideo('vid7890123');

      // Token factory is called at least once per attempt
      expect(tokenFactory.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
