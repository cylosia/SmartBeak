import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// P1-2 FIX (parallel to adapter spec): Mock @kernel/logger since youtubeAnalytics.ts
// now uses getLogger directly (migrated from @kernel/logger in this audit cycle).
jest.mock('@kernel/logger', () => ({
  getLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  }),
}));

// Mock node-fetch
jest.mock('node-fetch', () => {
  const fn = jest.fn();
  return { __esModule: true, default: fn };
});

jest.mock('@config', () => ({
  timeoutConfig: { long: 30000 },
  API_BASE_URLS: { youtubeAnalytics: 'https://youtubeanalytics.googleapis.com' },
}));

jest.mock('../../src/utils/retry', () => ({
  withRetry: jest.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
}));

jest.mock('../../src/utils/sanitize', () => ({
  sanitizeVideoIdForLog: jest.fn().mockImplementation((id: string) => id.slice(0, 20)),
}));

import { ingestYouTubeAnalytics } from '../../src/analytics/media/youtubeAnalytics';
import { ApiError } from '../../src/errors/ApiError';
import nodeFetch from 'node-fetch';

const fetchMock = nodeFetch as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ingestYouTubeAnalytics', () => {
  describe('input validation', () => {
    test('rejects empty accessToken', async () => {
      await expect(ingestYouTubeAnalytics('', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31'))
        .rejects.toThrow('Invalid accessToken');
    });

    // P1-4: videoId format validation
    test('rejects invalid videoId format', async () => {
      await expect(ingestYouTubeAnalytics('token', 'short', '2024-01-01', '2024-01-31'))
        .rejects.toThrow('must be an 11-character YouTube video ID');
    });

    test('rejects videoId with injection characters', async () => {
      await expect(ingestYouTubeAnalytics('token', 'a]||b==c;d!', '2024-01-01', '2024-01-31'))
        .rejects.toThrow('must be an 11-character YouTube video ID');
    });

    test('accepts valid 11-character videoId', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [[100, 10, 5]] }),
        text: async () => '{}',
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      const result = await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');
      expect(result).toEqual({ views: 100, likes: 10, comments: 5 });
    });

    // P1-5: date format validation
    test('rejects invalid date format', async () => {
      await expect(ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '01-01-2024', '2024-01-31'))
        .rejects.toThrow('YYYY-MM-DD format');
    });

    test('rejects endDate with invalid format', async () => {
      await expect(ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', 'Jan 31'))
        .rejects.toThrow('YYYY-MM-DD format');
    });

    // P1-5 FIX: Semantic date validation tests
    test('rejects semantically invalid dates like month 13', async () => {
      await expect(ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-13-01', '2024-01-31'))
        .rejects.toThrow('not a valid calendar date');
    });

    test('rejects Feb 30 overflow date', async () => {
      await expect(ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-02-30', '2024-03-31'))
        .rejects.toThrow('not a valid calendar date');
    });

    test('rejects reversed date range where startDate > endDate', async () => {
      await expect(ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-12-31', '2024-01-01'))
        .rejects.toThrow('startDate must be <= endDate');
    });

    test('accepts same start and end date', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [[10, 1, 0]] }),
        text: async () => '{}',
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      const result = await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-01');
      expect(result).toEqual({ views: 10, likes: 1, comments: 0 });
    });
  });

  describe('API interaction', () => {
    test('returns null when no rows', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [] }),
        text: async () => '{}',
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      const result = await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');
      expect(result).toBeNull();
    });

    test('returns null when row has too few columns', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [[100, 10]] }),  // Only 2 columns instead of 3
        text: async () => '{}',
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      const result = await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');
      expect(result).toBeNull();
    });

    // P0-2: Verify no dimensions parameter in request
    test('does not include dimensions parameter in API request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [[100, 10, 5]] }),
        text: async () => '{}',
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).not.toContain('dimensions');
      expect(url).toContain('metrics=views%2Clikes%2Ccomments');
    });

    // P1-1 FIX: ApiError now uses 422 (non-retryable) for schema failures.
    // This test verifies that a non-ok API response still throws ApiError with
    // the correct HTTP status for upstream retry decisions.
    test('throws ApiError with .status on non-ok response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'quota exceeded',
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      try {
        await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(403);
      }
    });

    // P1-3 FIX: Verify ApiError is now imported from errors/ApiError, not adapter
    test('throws ApiError instanceof check works with shared class', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      try {
        await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');
        expect.fail('Should have thrown');
      } catch (error) {
        // Both files now import from the same shared class — instanceof is reliable
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(429);
      }
    });

    test('uses configured youtubeAnalytics base URL', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [[100, 10, 5]] }),
        text: async () => '{}',
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain('youtubeanalytics.googleapis.com/v2/reports');
    });

    test('propagates error when response.json() throws on malformed body', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
        text: async () => '<html>502 Bad Gateway</html>',
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      await expect(ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31'))
        .rejects.toThrow(SyntaxError);
    });

    // P2-5 FIX: Test that empty first row doesn't lose valid data in subsequent rows
    test('finds valid data in second row when first row is empty', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [[], [200, 20, 10]] }),
        text: async () => '{}',
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      const result = await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');
      expect(result).toEqual({ views: 200, likes: 20, comments: 10 });
    });

    // P2-4 FIX: Test token factory support
    test('accepts a token factory function', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [[50, 5, 2]] }),
        text: async () => '{}',
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      const tokenFactory = jest.fn().mockReturnValue('factory-token');
      const result = await ingestYouTubeAnalytics(tokenFactory, 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');
      expect(result).toEqual({ views: 50, likes: 5, comments: 2 });
      expect(tokenFactory).toHaveBeenCalled();

      const [_url, options] = fetchMock.mock.calls[0] as [string, Record<string, unknown>];
      expect((options['headers'] as Record<string, string>)['Authorization']).toBe('Bearer factory-token');
    });
  });
});
