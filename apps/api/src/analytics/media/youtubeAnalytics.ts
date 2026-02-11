
import fetch from 'node-fetch';

import { timeoutConfig } from '@config';

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

/**
* Ingest YouTube analytics for a video
* @param accessToken - OAuth2 access token
* @param videoId - YouTube video ID
* @returns Analytics data
* MEDIUM FIX M3: Added JSDoc documentation
*/
export async function ingestYouTubeAnalytics(
  accessToken: string,
  videoId: string
): Promise<YouTubeAnalyticsData> {
  if (!accessToken || typeof accessToken !== 'string') {
  throw new Error('Invalid accessToken: must be a non-empty string');
  }
  if (!videoId || typeof videoId !== 'string') {
  throw new Error('Invalid videoId: must be a non-empty string');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutConfig.long);

  try {
  const res = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?` +
    new URLSearchParams({
      ids: 'channel==MINE',
      metrics: 'views,likes,comments',
      dimensions: 'video',
      filters: `video==${videoId}`
    }).toString(),
    {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    signal: controller.signal
    }
  );

  if (!res.ok) {
      const errorText = await res.text();
    throw new Error(`YouTube Analytics fetch failed: ${res.status} ${errorText}`);
  }

  const data = await res.json() as { rows?: number[][] };
  const row = data.rows?.[0] || [];

    return {
    views: typeof row[VIEWS_INDEX] === 'number' ? row[VIEWS_INDEX] : 0,
    likes: typeof row[LIKES_INDEX] === 'number' ? row[LIKES_INDEX] : 0,
    comments: typeof row[COMMENTS_INDEX] === 'number' ? row[COMMENTS_INDEX] : 0
  };
  } finally {
  clearTimeout(timeoutId);
  }
}
