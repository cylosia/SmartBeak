import fetch from 'node-fetch';

import { API_BASE_URLS, DEFAULT_TIMEOUTS } from '@config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '../../utils/request';
import { validateNonEmptyString } from '../../utils/validation';
import { withRetry } from '../../utils/retry';

﻿import { AbortController } from 'abort-controller';


/**
* Vimeo Publishing Adapter
*/

/**
* API Error with status code and retry information
*/
class ApiError extends Error {
  constructor(
  message: string,
  public status: number,
  public retryAfter?: string
  ) {
  super(message);
  this.name = 'ApiError';
  }
}

// Type guards
function isVimeoVideoResponse(data: unknown): data is VimeoVideoResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>)['uri'] === 'string'
  );
}

// Type definitions
export interface VimeoVideoMetadata {
  name?: string;
  description?: string;
  privacy?: {
  view?: 'anybody' | 'nobody' | 'password' | 'users' | 'disable';
  embed?: 'public' | 'private';
  download?: boolean;
  add?: boolean;
  comments?: 'anybody' | 'nobody';
  };
  content_rating?: string[];
}

export interface VimeoVideoResponse {
  uri: string;
  name?: string;
  description?: string;
  link?: string;
  player_embed_url?: string;
  status?: 'available' | 'unavailable' | 'uploading' | 'transcoding' | 'quarantined' | 'uploading_error' | 'transcoding_error' | 'transcode_starting';
}

export class VimeoAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs = DEFAULT_TIMEOUTS.long;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(private readonly accessToken: string) {
  // Input validation
  validateNonEmptyString(accessToken, 'accessToken');

  // Use configuration constant
  this.baseUrl = API_BASE_URLS.vimeo;
  this.logger = new StructuredLogger('VimeoAdapter');
  this.metrics = new MetricsCollector('VimeoAdapter');
  }

  /**
  * Update video metadata on Vimeo
  * @param videoId - The Vimeo video ID
  * @param metadata - Video metadata to update
  * @returns Updated video details
  * @throws Error if update fails or input is invalid
  */
  async updateMetadata(videoId: string, metadata: VimeoVideoMetadata): Promise<VimeoVideoResponse> {
  const context = createRequestContext('VimeoAdapter', 'updateMetadata');

  // Input validation
  validateNonEmptyString(videoId, 'videoId');

  const videoUri = videoId.startsWith('/videos/') ? videoId : `/videos/${encodeURIComponent(videoId)}`;

  this.logger.info('Updating Vimeo video metadata', context, { videoId });

  const startTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

  try {
    const res = await withRetry(async () => {
    const response = await fetch(`${this.baseUrl}${videoUri}`, {
    method: 'PATCH',
    headers: {
    'Authorization': `Bearer ${this.accessToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.vimeo.*+json;version=3.4',
    },
    body: JSON.stringify(metadata),
    signal: controller.signal,
    });

    // Check res.ok
    if (!response.ok) {
    const errorBody = await response.text();

    // Check for rate limiting
    if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || undefined;
    throw new ApiError(`Vimeo rate limited: ${response.status}`, response.status, retryAfter);
    }

    // Sanitized error message
    throw new Error(`Vimeo metadata update failed: ${response.status} ${response.statusText}`);
    }

    return response;
    }, { maxRetries: 3 });

    const rawData = await res.json();
    // Runtime response validation
    if (!rawData || typeof rawData !== 'object' || typeof (rawData as { uri?: unknown }).uri !== 'string') {
    throw new ApiError('Invalid response format from Vimeo API', 500);
    }
    if (!isVimeoVideoResponse(rawData)) {
      throw new ApiError('Invalid response format from Vimeo API', 500);
    }
    const data = rawData;

    const latency = Date.now() - startTime;
    this.metrics.recordLatency('updateMetadata', latency, true);
    this.metrics.recordSuccess('updateMetadata');
    this.logger.info('Successfully updated Vimeo metadata', context, { videoUri: data.uri });

    return data;
  } catch (error) {
    const latency = Date.now() - startTime;
    this.metrics.recordLatency('updateMetadata', latency, false);
    this.metrics.recordError('updateMetadata', error instanceof Error ? error.name : 'Unknown');
    this.logger.error('Failed to update Vimeo metadata', context, error as Error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  }

  /**
  * Get video details from Vimeo
  * @param videoId - The Vimeo video ID
  * @returns Video details
  * @throws Error if video not found or request fails
  */
  async getVideo(videoId: string): Promise<VimeoVideoResponse> {
  const context = createRequestContext('VimeoAdapter', 'getVideo');

  // Input validation
  validateNonEmptyString(videoId, 'videoId');

  const videoUri = videoId.startsWith('/videos/') ? videoId : `/videos/${encodeURIComponent(videoId)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

  try {
    const res = await withRetry(async () => {
    const response = await fetch(`${this.baseUrl}${videoUri}`, {
    method: 'GET',
    headers: {
    'Authorization': `Bearer ${this.accessToken}`,
    'Accept': 'application/vnd.vimeo.*+json;version=3.4',
    },
    signal: controller.signal,
    });

    // Check res.ok
    if (!response.ok) {
    if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || undefined;
    throw new ApiError(`Vimeo rate limited: ${response.status}`, response.status, retryAfter);
    }

    throw new ApiError(`Vimeo get video failed: ${response.status}`, response.status);
    }

    return response;
    }, { maxRetries: 3 });

    const rawData = await res.json();
    // Runtime response validation
    if (!rawData || typeof rawData !== 'object') {
    throw new ApiError('Invalid response format from Vimeo API', 500);
    }
    if (!isVimeoVideoResponse(rawData)) {
      throw new ApiError('Invalid response format from Vimeo API', 500);
    }
    const data = rawData;

    this.metrics.recordSuccess('getVideo');

    return data;
  } catch (error) {
    this.metrics.recordError('getVideo', error instanceof Error ? error.name : 'Unknown');
    this.logger.error('Failed to get Vimeo video', context, error as Error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  }

  /**
  * Health check for Vimeo API connection
  * @returns Health status with latency and optional error message
  */
  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string | undefined }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.short);

  try {
    // Check user info as health check
    const res = await fetch(`${this.baseUrl}/me`, {
    method: 'GET',
    headers: {
    'Authorization': `Bearer ${this.accessToken}`,
    'Accept': 'application/vnd.vimeo.*+json;version=3.4',
    },
    signal: controller.signal,
    });

    const latency = Date.now() - start;

    // Only 200-299 status codes indicate a healthy service
    const healthy = res.ok;

    return {
    healthy,
    latency,
    error: healthy ? undefined : `Vimeo API returned status ${res.status}`,
    };
  } catch (error) {
    return {
    healthy: false,
    latency: Date.now() - start,
    error: error instanceof Error ? error["message"] : 'Unknown error',
    };
  } finally {
    clearTimeout(timeoutId);
  }
  }
}
