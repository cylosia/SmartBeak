
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
const VIEWS_INDEX = 0;
const LIKES_INDEX = 1;
const COMMENTS_INDEX = 2;
const CHANNEL_MINE = 'channel==MINE';

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
  if (!videoId || typeof videoId !== 'string') {
    throw new Error('Invalid videoId: must be a non-empty string');
  }
  if (!startDate || typeof startDate !== 'string') {
    throw new Error('Invalid startDate: must be a non-empty string in YYYY-MM-DD format');
  }
  if (!endDate || typeof endDate !== 'string') {
    throw new Error('Invalid endDate: must be a non-empty string in YYYY-MM-DD format');
  }

  const data = await withRetry(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutConfig.long);

    try {
      const res = await fetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?` +
        new URLSearchParams({
          ids: CHANNEL_MINE,
          metrics: 'views,likes,comments',
          dimensions: 'video',
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
        const errorText = await res.text();
        logger.error('YouTube Analytics API error', { status: res.status, body: errorText, videoId });
        throw new Error(`YouTube Analytics fetch failed with status ${res.status}`);
      }

      const rawJson: unknown = await res.json();
      const parsed = YouTubeAnalyticsResponseSchema.safeParse(rawJson);
      if (!parsed.success) {
        logger.error('Invalid YouTube Analytics response shape', { videoId, error: parsed.error.message });
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

  return {
    views: typeof row[VIEWS_INDEX] === 'number' ? row[VIEWS_INDEX] : 0,
    likes: typeof row[LIKES_INDEX] === 'number' ? row[LIKES_INDEX] : 0,
    comments: typeof row[COMMENTS_INDEX] === 'number' ? row[COMMENTS_INDEX] : 0,
  };
}
