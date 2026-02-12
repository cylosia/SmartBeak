
import { vi, describe, test, expect, beforeEach } from 'vitest';

// Mock node-fetch
vi.mock('node-fetch', () => {
  const fn = vi.fn();
  return { __esModule: true, default: fn };
});

vi.mock('@config', () => ({
  timeoutConfig: { long: 30000 },
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

    // P1-3: Error has .status for retry logic
    test('throws error with .status on non-ok response (P1-3)', async () => {
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
        expect((error as Error & { status: number }).status).toBe(403);
      }
    });
  });
});
