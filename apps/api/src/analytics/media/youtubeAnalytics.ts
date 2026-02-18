import fetch from 'node-fetch';
import { z } from 'zod';

import { timeoutConfig, API_BASE_URLS } from '@config';
import { getLogger } from '@kernel/logger';
import { ValidationError, ErrorCodes } from '@errors';

import { withRetry } from '../../utils/retry';
import { ApiError } from '../../errors/ApiError';
import { sanitizeVideoIdForLog } from '../../utils/sanitize';

// ── Module-level constants & configuration ──────────────────────────────

const logger = getLogger('youtubeAnalytics');

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

// ── Types & interfaces ──────────────────────────────────────────────────────────────

/**
* YouTube analytics data structure
*/
export interface YouTubeAnalyticsData {
  views: number;
  likes: number;
  comments: number;
}

// ── Exported API ────────────────────────────────────────────────────────────

/**
* Ingest YouTube analytics for a video
*
* Audit fixes (all cycles):
* - P0-2: Removed dimensions parameter to fix data-loss bug
* - P1-1: ApiError now uses 422 (non-retryable) for schema validation failures
*         instead of 500 (retryable), preventing 3× quota burn per call when
*         the API returns an unexpected response shape
* - P1-3: ApiError imported from shared errors/ApiError.ts, not from adapter
* - P2-2: sanitizeVideoIdForLog imported from shared utils/sanitize.ts
* - P2-4: Token factory for OAuth token refresh in long-lived workers
* - P2-5: ValidationError from @errors instead of raw Error for input validation
* - P2-5: Find first non-empty row instead of blindly using rows[0]
* - P3-6: Explicit type assertion for date split with regex guarantee comment
*
* @param accessTokenOrFactory - OAuth2 access token or factory function for token refresh
* @param videoId - YouTube video ID (must be 11-character base64url)
* @param startDate - Start date in YYYY-MM-DD format
* @param endDate - End date in YYYY-MM-DD format
* @returns Analytics data, or null if no data was returned for the video
*/
export async function ingestYouTubeAnalytics(
  accessTokenOrFactory: string | (() => string | Promise<string>),
  videoId: string,
  startDate: string,
  endDate: string,
): Promise<YouTubeAnalyticsData | null> {
  // P2-4 FIX: Resolve token from factory or validate static string
  let resolveToken: () => string | Promise<string>;
  if (typeof accessTokenOrFactory === 'string') {
    if (!accessTokenOrFactory) {
      // P2-5 FIX: ValidationError instead of raw Error
      throw new ValidationError('Invalid accessToken: must be a non-empty string', ErrorCodes.VALIDATION_ERROR);
    }
    resolveToken = () => accessTokenOrFactory;
  } else {
    resolveToken = accessTokenOrFactory;
  }

  // P1-4 FIX: Validate videoId format to prevent filter injection
  if (!videoId || typeof videoId !== 'string') {
    throw new ValidationError('Invalid videoId: must be a non-empty string', ErrorCodes.VALIDATION_ERROR);
  }
  if (!YOUTUBE_VIDEO_ID_REGEX.test(videoId)) {
    throw new ValidationError(
      'Invalid videoId: must be an 11-character YouTube video ID',
      ErrorCodes.VALIDATION_ERROR,
    );
  }

  // P1-5 FIX: Semantic date validation with roundtrip check
  validateAnalyticsDate(startDate, 'startDate');
  validateAnalyticsDate(endDate, 'endDate');

  // P1-5 FIX: Temporal ordering check — reversed ranges return
  // empty data indistinguishable from "no analytics," causing silent failures.
  if (startDate > endDate) {
    throw new ValidationError(
      'Invalid date range: startDate must be <= endDate',
      ErrorCodes.VALIDATION_ERROR,
    );
  }

  const data = await withRetry(async () => {
    // P2-4 FIX: Resolve token inside retry for fresh token on each attempt
    const accessToken = await resolveToken();
    if (!accessToken || typeof accessToken !== 'string') {
      throw new ValidationError(
        'Invalid accessToken: factory must return a non-empty string',
        ErrorCodes.VALIDATION_ERROR,
      );
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutConfig.long);

    try {
      // P0-2 FIX: Removed `dimensions: 'video'` — the filter already selects
      // the target video, and including dimensions prepends a string column
      // that breaks the numeric-only Zod schema.
      // P1-3 FIX: Use centralized API_BASE_URLS instead of hardcoded URL
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
            'Accept': 'application/json',
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
          videoId: sanitizeVideoIdForLog(videoId),
        });
        throw new ApiError(
          `YouTube Analytics fetch failed with status ${res.status}`,
          res.status,
          undefined,
          errorText,
        );
      }

      const rawJson: unknown = await res.json();
      const parsed = YouTubeAnalyticsResponseSchema.safeParse(rawJson);
      if (!parsed.success) {
        logger.error('Invalid YouTube Analytics response shape', new Error(parsed.error.message), {
          videoId: sanitizeVideoIdForLog(videoId),
        });
        // P1-1 FIX: Use 422 (non-retryable) instead of 500 for schema validation
        // failures. withRetry treats 500 as retryable (it's in retryableStatuses),
        // which would burn 4× quota per call on every API schema change. A 422
        // will not be retried since it is not in retryableStatuses.
        throw new ApiError('Invalid response format from YouTube Analytics API', 422);
      }
      return parsed.data;
    } finally {
      clearTimeout(timeoutId);
    }
  }, { maxRetries: 3 });

  // P2-5 FIX: Find first row with enough columns instead of blindly
  // using rows[0]. Protects against empty leading rows from the YouTube API.
  const row = data.rows?.find((r: number[]) => r.length >= EXPECTED_METRIC_COUNT);
  if (!row) {
    return null;
  }

  // Redundant after find() filter above, kept as defense-in-depth
  if (row.length < EXPECTED_METRIC_COUNT) {
    logger.warn('YouTube Analytics row has fewer columns than expected', {
      videoId: sanitizeVideoIdForLog(videoId),
      expected: EXPECTED_METRIC_COUNT,
      actual: row.length,
    });
    return null;
  }

  // Zod schema z.array(z.number()) guarantees these are numbers.
  const views = row[VIEWS_INDEX]!;
  const likes = row[LIKES_INDEX]!;
  const comments = row[COMMENTS_INDEX]!;

  return { views, likes, comments };
}

// ── Private helpers ─────────────────────────────────────────────────────

/**
 * P1-5 FIX: Semantic date validation beyond regex format check.
 * Rejects dates like 2024-13-45 or 2024-02-30 that pass the regex.
 */
function validateAnalyticsDate(dateStr: string, name: string): void {
  if (!dateStr || typeof dateStr !== 'string' || !DATE_FORMAT_REGEX.test(dateStr)) {
    throw new ValidationError(
      `Invalid ${name}: must be a string in YYYY-MM-DD format`,
      ErrorCodes.VALIDATION_ERROR,
    );
  }
  const parsed = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(parsed.getTime())) {
    throw new ValidationError(
      `Invalid ${name}: '${dateStr}' is not a valid calendar date`,
      ErrorCodes.VALIDATION_ERROR,
    );
  }
  // Roundtrip check catches month/day overflow (e.g., 2024-02-30 -> 2024-03-01)
  // P3-6 FIX: Explicit assertion — regex guarantees exactly 3 numeric segments
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() + 1 !== m || parsed.getUTCDate() !== d) {
    throw new ValidationError(
      `Invalid ${name}: '${dateStr}' is not a valid calendar date`,
      ErrorCodes.VALIDATION_ERROR,
    );
  }
}
