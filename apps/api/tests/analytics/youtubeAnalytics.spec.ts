
import { vi, describe, test, expect, beforeEach } from 'vitest';

// Mock node-fetch
vi.mock('node-fetch', () => {
  const fn = vi.fn();
  return { __esModule: true, default: fn };
});

vi.mock('@config', () => ({
  timeoutConfig: { long: 30000 },
  API_BASE_URLS: { youtubeAnalytics: 'https://youtubeanalytics.googleapis.com' },
}));

vi.mock('../../src/utils/retry', () => ({
  withRetry: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@kernel/logger', () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { ingestYouTubeAnalytics } from '../../src/analytics/media/youtubeAnalytics';
import { ApiError } from '../../src/adapters/youtube/YouTubeAdapter';
import nodeFetch from 'node-fetch';

const fetchMock = nodeFetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
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
        headers: { get: vi.fn().mockReturnValue(null) },
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

    // P1-5 FIX (audit 2): Semantic date validation tests
    test('rejects semantically invalid dates like month 13 (P1-5)', async () => {
      await expect(ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-13-01', '2024-01-31'))
        .rejects.toThrow('not a valid calendar date');
    });

    test('rejects Feb 30 overflow date (P1-5)', async () => {
      await expect(ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-02-30', '2024-03-31'))
        .rejects.toThrow('not a valid calendar date');
    });

    test('rejects reversed date range where startDate > endDate (P1-5)', async () => {
      await expect(ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-12-31', '2024-01-01'))
        .rejects.toThrow('startDate must be <= endDate');
    });

    test('accepts same start and end date', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [[10, 1, 0]] }),
        text: async () => '{}',
        headers: { get: vi.fn().mockReturnValue(null) },
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
        headers: { get: vi.fn().mockReturnValue(null) },
      });

      const result = await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');
      expect(result).toBeNull();
    });

    test('returns null when row has too few columns (P2-10)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [[100, 10]] }),  // Only 2 columns instead of 3
        text: async () => '{}',
        headers: { get: vi.fn().mockReturnValue(null) },
      });

      const result = await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');
      expect(result).toBeNull();
    });

    // P0-2: Verify no dimensions parameter in request
    test('does not include dimensions parameter in API request (P0-2)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [[100, 10, 5]] }),
        text: async () => '{}',
        headers: { get: vi.fn().mockReturnValue(null) },
      });

      await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).not.toContain('dimensions');
      expect(url).toContain('metrics=views%2Clikes%2Ccomments');
    });

    // P2-2 FIX (audit 2): Now throws ApiError instead of monkey-patched Error
    test('throws ApiError with .status on non-ok response (P1-3, P2-2)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'quota exceeded',
        headers: { get: vi.fn().mockReturnValue(null) },
      });

      try {
        await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(403);
      }
    });

    // P1-3 FIX (audit 2): Uses centralized API_BASE_URLS
    test('uses configured youtubeAnalytics base URL (P1-3)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [[100, 10, 5]] }),
        text: async () => '{}',
        headers: { get: vi.fn().mockReturnValue(null) },
      });

      await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain('youtubeanalytics.googleapis.com/v2/reports');
    });

    // P3-7 FIX (audit 3): Test for response.json() throwing on malformed body
    test('propagates error when response.json() throws on malformed body (P3-7 audit 3)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
        text: async () => '<html>502 Bad Gateway</html>',
        headers: { get: vi.fn().mockReturnValue(null) },
      });

      await expect(ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31'))
        .rejects.toThrow(SyntaxError);
    });

    // P2-5 FIX (audit 3): Test that empty first row doesn't lose valid data in subsequent rows
    test('finds valid data in second row when first row is empty (P2-5 audit 3)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [[], [200, 20, 10]] }),
        text: async () => '{}',
        headers: { get: vi.fn().mockReturnValue(null) },
      });

      const result = await ingestYouTubeAnalytics('token', 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');
      expect(result).toEqual({ views: 200, likes: 20, comments: 10 });
    });

    // P2-4 FIX (audit 3): Test token factory support
    test('accepts a token factory function (P2-4 audit 3)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [[50, 5, 2]] }),
        text: async () => '{}',
        headers: { get: vi.fn().mockReturnValue(null) },
      });

      const tokenFactory = vi.fn().mockReturnValue('factory-token');
      const result = await ingestYouTubeAnalytics(tokenFactory, 'dQw4w9WgXcQ', '2024-01-01', '2024-01-31');
      expect(result).toEqual({ views: 50, likes: 5, comments: 2 });
      expect(tokenFactory).toHaveBeenCalled();

      const [url, options] = fetchMock.mock.calls[0] as [string, Record<string, unknown>];
      expect((options['headers'] as Record<string, string>)['Authorization']).toBe('Bearer factory-token');
    });
  });
});
