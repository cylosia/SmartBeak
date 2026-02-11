import { z } from 'zod';
import { API_BASE_URLS, API_VERSIONS, DEFAULT_TIMEOUTS } from '@config';
import { validateNonEmptyString } from '../../utils/validation';
import { AbortController } from 'abort-controller';
import fetch from 'node-fetch';
import { withRetry } from '../../utils/retry';
import { StructuredLogger, createRequestContext, MetricsCollector } from '../../utils/request';

/**
 * YouTube Publishing Adapter
 *
 * MEDIUM FIX M3: Added structured logging
 * MEDIUM FIX M4: Added request IDs
 * MEDIUM FIX M5: Added metrics
 * MEDIUM FIX M7: Added health check
 */

/**
 * API Error with status code and retry information
 */
class ApiError extends Error {
  status: number;
  retryAfter?: string | undefined;
  constructor(message: string, status: number, retryAfter?: string | undefined) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.name = 'ApiError';
  }
}

// YouTube API response type guards
function isYouTubeVideoResponse(data: unknown): data is YouTubeVideoResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>)['id'] === 'string'
  );
}

function isYouTubeVideoListResponse(data: unknown): data is { items: YouTubeVideoResponse[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as Record<string, unknown>)['items'])
  );
}

export interface YouTubeVideoSnippet {
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  defaultLanguage?: string;
}

export interface YouTubeVideoStatus {
  privacyStatus?: 'public' | 'unlisted' | 'private';
  publishAt?: string;
  selfDeclaredMadeForKids?: boolean;
}

export interface YouTubeVideoResponse {
  id: string;
  snippet?: YouTubeVideoSnippet;
  status?: YouTubeVideoStatus;
}

export interface YouTubeVideoMetadata {
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  defaultLanguage?: string;
}

export interface HealthCheckResult {
  healthy: boolean;
  latency: number;
  error?: string | undefined;
}

export class YouTubeAdapter {
  private accessToken: string;
  private baseUrl: string;
  private timeoutMs: number;
  private logger: StructuredLogger;
  private metrics: MetricsCollector;

  constructor(accessToken: string) {
    this.accessToken = accessToken;

    validateNonEmptyString(accessToken, 'accessToken');

    this.baseUrl = `${API_BASE_URLS.youtube}/${API_VERSIONS.youtube}`;
    this.timeoutMs = DEFAULT_TIMEOUTS.long;
    this.logger = new StructuredLogger('YouTubeAdapter');
    this.metrics = new MetricsCollector('YouTubeAdapter');
  }

  /**
   * Update video metadata
   */
  async updateMetadata(videoId: string, metadata: YouTubeVideoMetadata): Promise<YouTubeVideoResponse> {
    const context = createRequestContext('YouTubeAdapter', 'updateMetadata');

    validateNonEmptyString(videoId, 'videoId');
    this.logger.info('Updating YouTube video metadata', context, { videoId });
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await withRetry(async () => {
        const response = await fetch(`${this.baseUrl}/videos?part=snippet`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            id: videoId,
            snippet: metadata,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text();

          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after') || undefined;
            throw new ApiError(`YouTube rate limited: ${response.status}`, response.status, retryAfter);
          }

          throw new Error(`YouTube metadata update failed: ${response.status} ${response.statusText}`);
        }
        return response;
      }, { maxRetries: 3 });

      const rawData = await res.json();
      if (!isYouTubeVideoResponse(rawData)) {
        throw new ApiError('Invalid response format from YouTube API', 500);
      }
      const data = rawData;
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('updateMetadata', latency, true);
      this.metrics.recordSuccess('updateMetadata');
      this.logger.info('Successfully updated YouTube metadata', context, { videoId: data.id });
      return data;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('updateMetadata', latency, false);
      this.metrics.recordError('updateMetadata', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to update YouTube metadata', context, error as Error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get video details
   */
  async getVideo(videoId: string, parts: string[] = ['snippet', 'status']): Promise<YouTubeVideoResponse> {
    const context = createRequestContext('YouTubeAdapter', 'getVideo');

    validateNonEmptyString(videoId, 'videoId');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await withRetry(async () => {
        const url = new URL(`${this.baseUrl}/videos`);
        url.searchParams.append('id', videoId);
        url.searchParams.append('part', parts.join(','));
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after') || undefined;
            throw new ApiError(`YouTube rate limited: ${response.status}`, response.status, retryAfter);
          }
          throw new ApiError(`YouTube get video failed: ${response.status}`, response.status);
        }
        return response;
      }, { maxRetries: 3 });

      const rawData = await res.json();
      if (!isYouTubeVideoListResponse(rawData)) {
        throw new ApiError('Invalid response format from YouTube API', 500);
      }
      const data = rawData;
      const firstItem = data.items[0];
      if (!firstItem) {
        throw new Error(`Video not found: ${videoId}`);
      }
      this.metrics.recordSuccess('getVideo');
      return firstItem;
    } catch (error) {
      this.metrics.recordError('getVideo', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to get YouTube video', context, error as Error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * MEDIUM FIX M7: Health check for YouTube API
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.short);
    try {
      // Check quota / channels endpoint as health check
      const res = await fetch(`${this.baseUrl}/channels?part=id&mine=true`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      const latency = Date.now() - start;
      const healthy = res.ok;  // Remove auth error codes
      return {
        healthy,
        latency,
        error: healthy ? undefined : `YouTube API returned status ${res.status}`,
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
