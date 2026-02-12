
import fetch from 'node-fetch';
import { z } from 'zod';

import { timeoutConfig } from '@config';
import { withRetry } from '../../utils/retry';
import { getLogger } from '@kernel/logger';

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
  // P1-5 FIX: Validate date format
  if (!startDate || typeof startDate !== 'string' || !DATE_FORMAT_REGEX.test(startDate)) {
    throw new Error('Invalid startDate: must be a string in YYYY-MM-DD format');
  }
  if (!endDate || typeof endDate !== 'string' || !DATE_FORMAT_REGEX.test(endDate)) {
    throw new Error('Invalid endDate: must be a string in YYYY-MM-DD format');
  }

  const data = await withRetry(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutConfig.long);

    try {
      // P0-2 FIX: Removed `dimensions: 'video'` — the filter already selects
      // the target video, and including dimensions prepends a string column
      // that breaks the numeric-only Zod schema.
      const res = await fetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?` +
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
          },
          signal: controller.signal,
        },
      );

      if (!res.ok) {
        // P0-1 pattern: wrap response.text() to avoid masking the HTTP status
        let errorText = '';
        try { errorText = await res.text(); } catch { /* body unreadable */ }
        logger.error('YouTube Analytics API error', new Error(`HTTP ${res.status}`), {
          status: res.status,
          body: errorText.slice(0, 1024),
          videoId,
        });
        // P1-3 FIX: Attach .status so withRetry can detect non-retryable errors
        const err = new Error(`YouTube Analytics fetch failed with status ${res.status}`) as Error & { status: number };
        err.status = res.status;
        throw err;
      }

      const rawJson: unknown = await res.json();
      const parsed = YouTubeAnalyticsResponseSchema.safeParse(rawJson);
      if (!parsed.success) {
        logger.error('Invalid YouTube Analytics response shape', new Error(parsed.error.message), { videoId });
        throw new Error('Invalid response format from YouTube Analytics API');
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
    logger.warn('YouTube Analytics row has fewer columns than expected', {
      videoId,
      expected: EXPECTED_METRIC_COUNT,
      actual: row.length,
    });
    return null;
  }

  const views = row[VIEWS_INDEX];
  const likes = row[LIKES_INDEX];
  const comments = row[COMMENTS_INDEX];

  return {
    views: typeof views === 'number' ? views : 0,
    likes: typeof likes === 'number' ? likes : 0,
    comments: typeof comments === 'number' ? comments : 0,
  };
}
