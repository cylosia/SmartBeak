import fetch from 'node-fetch';
import FormData from 'form-data';

import { API_BASE_URLS, DEFAULT_TIMEOUTS } from '@config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '../../utils/request';
import { validateNonEmptyString } from '../../utils/validation';
import { withRetry } from '../../utils/retry';

﻿import { AbortController } from 'abort-controller';


/**
* SoundCloud Publishing Adapter
*
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
function isSoundCloudTrackResponse(data: unknown): data is SoundCloudTrackResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>)['id'] === 'number' &&
    typeof (data as Record<string, unknown>)['uri'] === 'string'
  );
}

// Type definitions
export interface SoundCloudUploadInput {
  title: string;
  asset_data: Buffer;
  description?: string;
  genre?: string;
  tag_list?: string;
  sharing?: 'public' | 'private';
  downloadable?: boolean;
  purchase_url?: string;
}

export interface SoundCloudTrackResponse {
  id: number;
  uri: string;
  title: string;
  permalink_url?: string;
  artwork_url?: string;
  stream_url?: string;
  status?: 'processing' | 'failed' | 'finished';
}

export class SoundCloudAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs = DEFAULT_TIMEOUTS.extended; // Longer timeout for uploads
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(private readonly accessToken: string) {
  validateNonEmptyString(accessToken, 'accessToken');

  this.baseUrl = API_BASE_URLS.soundcloud;
  this.logger = new StructuredLogger('SoundCloudAdapter');
  this.metrics = new MetricsCollector('SoundCloudAdapter');
  }

  /**
  * Upload a track to SoundCloud
  */
  async uploadTrack(input: SoundCloudUploadInput): Promise<SoundCloudTrackResponse> {
  const context = createRequestContext('SoundCloudAdapter', 'uploadTrack');

  validateNonEmptyString(input.title, 'title');

  this.logger.info('Uploading track to SoundCloud', context, { title: input.title });

  const startTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

  try {
    const res = await withRetry(async () => {
    const formData = new FormData();
    formData.append('track[title]', input.title);
    // Generate filename from title or use default
    const sanitizedTitle = input.title.replace(/[^a-zA-Z0-9\-_]/g, '_').substring(0, 50);
    const filename = sanitizedTitle ? `${sanitizedTitle}.mp3` : 'track.mp3';

    // Validate buffer size
    if (!input.asset_data || input.asset_data.length === 0) {
    throw new ApiError('Asset data is empty', 400);
    }
    if (input.asset_data.length > 500 * 1024 * 1024) { // 500MB limit
    throw new ApiError(`Asset data exceeds maximum size of 500MB (actual: ${(input.asset_data.length / 1024 / 1024).toFixed(2)}MB)`, 400);
    }

    formData.append('track[asset_data]', input.asset_data, { filename });

    if (input.description) formData.append('track[description]', input.description);
    if (input.genre) formData.append('track[genre]', input.genre);
    if (input.tag_list) formData.append('track[tag_list]', input.tag_list);
    if (input.sharing) formData.append('track[sharing]', input.sharing);
    if (input.downloadable !== undefined) formData.append('track[downloadable]', String(input.downloadable));
    if (input.purchase_url) formData.append('track[purchase_url]', input.purchase_url);

    const response = await fetch(`${this.baseUrl}/tracks`, {
    method: 'POST',
    headers: {
    'Authorization': `OAuth ${this.accessToken}`,
    ...formData.getHeaders(),
    },
    body: formData,
    signal: controller.signal,
    });

    if (!response.ok) {
    const errorBody = await response.text();

    if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || undefined;
    throw new ApiError(`SoundCloud rate limited: ${response.status}`, response.status, retryAfter);
    }

    throw new Error(`SoundCloud upload failed: ${response.status} ${response.statusText}`);
    }

    return response;
    }, { maxRetries: 3 });

    const rawData = await res.json();
    if (!rawData || typeof rawData !== 'object') {
    throw new ApiError('Invalid response format from SoundCloud API', 500);
    }
    if (!isSoundCloudTrackResponse(rawData)) {
      throw new ApiError('Invalid response format from SoundCloud API', 500);
    }
    const data = rawData;

    const latency = Date.now() - startTime;
    this.metrics.recordLatency('uploadTrack', latency, true);
    this.metrics.recordSuccess('uploadTrack');
    this.logger.info('Successfully uploaded to SoundCloud', context, { trackId: data.id });

    return data;
  } catch (error) {
    const latency = Date.now() - startTime;
    this.metrics.recordLatency('uploadTrack', latency, false);
    this.metrics.recordError('uploadTrack', error instanceof Error ? error.name : 'Unknown');
    this.logger.error('Failed to upload to SoundCloud', context, error as Error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  }

  /**
  * Get track details
  */
  async getTrack(trackId: number): Promise<SoundCloudTrackResponse> {
  const context = createRequestContext('SoundCloudAdapter', 'getTrack');

  if (typeof trackId !== 'number' || isNaN(trackId)) {
    throw new Error('trackId must be a valid number');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.medium);

  try {
    const res = await withRetry(async () => {
    const response = await fetch(`${this.baseUrl}/tracks/${trackId}`, {
    method: 'GET',
    headers: {
    'Authorization': `OAuth ${this.accessToken}`,
    'Accept': 'application/json',
    },
    signal: controller.signal,
    });

    if (!response.ok) {
    if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || undefined;
    throw new ApiError(`SoundCloud rate limited: ${response.status}`, response.status, retryAfter);
    }

    throw new ApiError(`SoundCloud get track failed: ${response.status}`, response.status);
    }

    return response;
    }, { maxRetries: 3 });

    const rawData = await res.json();
    if (!rawData || typeof rawData !== 'object') {
    throw new ApiError('Invalid response format from SoundCloud API', 500);
    }
    if (!isSoundCloudTrackResponse(rawData)) {
      throw new ApiError('Invalid response format from SoundCloud API', 500);
    }
    const data = rawData;

    this.metrics.recordSuccess('getTrack');

    return data;
  } catch (error) {
    this.metrics.recordError('getTrack', error instanceof Error ? error.name : 'Unknown');
    this.logger.error('Failed to get SoundCloud track', context, error as Error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string | undefined }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.short);

  try {
    // Check user/me endpoint as health check
    const res = await fetch(`${this.baseUrl}/me`, {
    method: 'GET',
    headers: {
    'Authorization': `OAuth ${this.accessToken}`,
    'Accept': 'application/json',
    },
    signal: controller.signal,
    });

    const latency = Date.now() - start;

    // Only 200-299 status codes indicate a healthy service
    const healthy = res.ok;

    return {
    healthy,
    latency,
    error: healthy ? undefined : `SoundCloud API returned status ${res.status}`,
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
