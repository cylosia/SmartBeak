
import fetch from 'node-fetch';
import { z } from 'zod';

import { timeoutConfig, API_BASE_URLS } from '@config';
import { withRetry } from '../../utils/retry';
import { getLogger } from '@kernel/logger';
import { ApiError } from '../../adapters/youtube/YouTubeAdapter';

const logger = getLogger('youtubeAnalytics');

/**
* YouTube analytics data structure
*/
export interface YouTubeAnalyticsData {
  views: number;
  likes: number;
  comments: number;
}

// Constants for array indices in YouTube Analytics API response
// P0-2 FIX: Removed `dimensions: 'video'` from the request. The
// `filters: video==${videoId}` already selects the video. Including
// `dimensions` caused the API to prepend a string video-ID column,
// which broke the z.array(z.number()) Zod schema and made safeParse
// fail on every call, silently returning null (complete data loss).
const VIEWS_INDEX = 0;
const LIKES_INDEX = 1;
const COMMENTS_INDEX = 2;
const EXPECTED_METRIC_COUNT = 3;
const CHANNEL_MINE = 'channel==MINE';

// P1-4 FIX: YouTube video IDs are exactly 11 base64url characters
const YOUTUBE_VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

// P1-5 FIX: Validate YYYY-MM-DD format
const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** P2-8 FIX (audit 2): Sanitize videoId in log messages for defense-in-depth */
const MAX_VIDEO_ID_LOG_LENGTH = 20;
function sanitizeVideoIdForLog(videoId: string): string {
  return videoId.slice(0, MAX_VIDEO_ID_LOG_LENGTH).replace(/[^\w-]/g, '');
}

/**
 * P1-5 FIX (audit 2): Semantic date validation beyond regex format check.
 * Rejects dates like 2024-13-45 or 2024-02-30 that pass the regex.
 */
function validateAnalyticsDate(dateStr: string, name: string): void {
  if (!dateStr || typeof dateStr !== 'string' || !DATE_FORMAT_REGEX.test(dateStr)) {
    throw new Error(`Invalid ${name}: must be a string in YYYY-MM-DD format`);
  }
  const parsed = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${name}: '${dateStr}' is not a valid calendar date`);
  }
  // Roundtrip check catches month/day overflow (e.g., 2024-02-30 -> 2024-03-01)
  const [y, m, d] = dateStr.split('-').map(Number);
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() + 1 !== m || parsed.getUTCDate() !== d) {
    throw new Error(`Invalid ${name}: '${dateStr}' is not a valid calendar date`);
  }
}

/**
 * Zod schema for validating the YouTube Analytics API response.
 * Ensures rows contain arrays of numbers before we index into them.
 */
const YouTubeAnalyticsResponseSchema = z.object({
  rows: z.array(z.array(z.number())).optional(),
});

/**
* Ingest YouTube analytics for a video
* @param accessToken - OAuth2 access token
* @param videoId - YouTube video ID
* @param startDate - Start date in YYYY-MM-DD format (required by YouTube Analytics API)
* @param endDate - End date in YYYY-MM-DD format (required by YouTube Analytics API)
* @returns Analytics data, or null if no data was returned for the video
*/
export async function ingestYouTubeAnalytics(
  accessToken: string,
  videoId: string,
  startDate: string,
  endDate: string,
): Promise<YouTubeAnalyticsData | null> {
  if (!accessToken || typeof accessToken !== 'string') {
    throw new Error('Invalid accessToken: must be a non-empty string');
  }
  // P1-4 FIX: Validate videoId format to prevent filter injection
  if (!videoId || typeof videoId !== 'string') {
    throw new Error('Invalid videoId: must be a non-empty string');
  }
  if (!YOUTUBE_VIDEO_ID_REGEX.test(videoId)) {
    throw new Error('Invalid videoId: must be an 11-character YouTube video ID');
  }
  // P1-5 FIX (audit 2): Semantic date validation with roundtrip check
  validateAnalyticsDate(startDate, 'startDate');
  validateAnalyticsDate(endDate, 'endDate');

  // P1-5 FIX (audit 2): Temporal ordering check — reversed ranges return
  // empty data indistinguishable from "no analytics," causing silent failures.
  if (startDate > endDate) {
    throw new Error('Invalid date range: startDate must be <= endDate');
  }

  const data = await withRetry(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutConfig.long);

    try {
      // P0-2 FIX: Removed `dimensions: 'video'` — the filter already selects
      // the target video, and including dimensions prepends a string column
      // that breaks the numeric-only Zod schema.
      // P1-3 FIX (audit 2): Use centralized API_BASE_URLS instead of hardcoded URL
      const res = await fetch(
        `${API_BASE_URLS.youtubeAnalytics}/v2/reports?` +
        new URLSearchParams({
          ids: CHANNEL_MINE,
          metrics: 'views,likes,comments',
          filters: `video==${videoId}`,
          startDate,
          endDate,
        }).toString(),
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            // P2-4 FIX (audit 2): Explicit Accept header for content negotiation
            'Accept': 'application/json',
          },
          signal: controller.signal,
        },
      );

      if (!res.ok) {
        // P0-1 pattern: wrap response.text() to avoid masking the HTTP status
        let errorText = '';
        try { errorText = await res.text(); } catch { /* body unreadable */ }
        // P2-8 FIX (audit 2): Sanitize videoId in log messages
        logger.error('YouTube Analytics API error', new Error(`HTTP ${res.status}`), {
          status: res.status,
          body: errorText.slice(0, 1024),
          videoId: sanitizeVideoIdForLog(videoId),
        });
        // P2-2 FIX (audit 2): Use typed ApiError instead of monkey-patched Error
        throw new ApiError(`YouTube Analytics fetch failed with status ${res.status}`, res.status, undefined, errorText);
      }

      const rawJson: unknown = await res.json();
      const parsed = YouTubeAnalyticsResponseSchema.safeParse(rawJson);
      if (!parsed.success) {
        // P2-8 FIX (audit 2): Sanitize videoId in log messages
        logger.error('Invalid YouTube Analytics response shape', new Error(parsed.error.message), { videoId: sanitizeVideoIdForLog(videoId) });
        throw new ApiError('Invalid response format from YouTube Analytics API', 500);
      }
      return parsed.data;
    } finally {
      clearTimeout(timeoutId);
    }
  }, { maxRetries: 3 });

  const row = data.rows?.[0];
  if (!row || row.length === 0) {
    return null;
  }

  // P2-10 FIX: Validate row has expected number of metric columns
  if (row.length < EXPECTED_METRIC_COUNT) {
    // P2-8 FIX (audit 2): Sanitize videoId in log messages
    logger.warn('YouTube Analytics row has fewer columns than expected', {
      videoId: sanitizeVideoIdForLog(videoId),
      expected: EXPECTED_METRIC_COUNT,
      actual: row.length,
    });
    return null;
  }

  // P2-7 FIX (audit 2): Zod schema z.array(z.number()) guarantees these are
  // numbers. Removed redundant typeof checks that silently fell back to 0,
  // which would mask data corruption instead of failing loudly.
  const views = row[VIEWS_INDEX]!;
  const likes = row[LIKES_INDEX]!;
  const comments = row[COMMENTS_INDEX]!;

  return { views, likes, comments };
}
