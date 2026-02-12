import { z } from 'zod';
import { API_BASE_URLS, API_VERSIONS, DEFAULT_TIMEOUTS } from '@config';
import { validateNonEmptyString } from '../../utils/validation';
import fetch from 'node-fetch';
import { withRetry } from '../../utils/retry';
import { StructuredLogger, createRequestContext, MetricsCollector } from '../../utils/request';
import {
  YouTubeVideoSnippet,
  YouTubeVideoStatus,
  YouTubeVideoResponse,
} from '../../utils/validation/social';

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
    this.name = this.constructor.name;
  }
}

/**
 * Zod schema for runtime validation of YouTube single-video responses.
 * Validates structure beyond just checking for an 'id' field.
 */
const YouTubeVideoResponseSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    categoryId: z.string().optional(),
    defaultLanguage: z.string().optional(),
  }).optional(),
  status: z.object({
    privacyStatus: z.enum(['public', 'unlisted', 'private']).optional(),
    publishAt: z.string().optional(),
    selfDeclaredMadeForKids: z.boolean().optional(),
  }).optional(),
});

/**
 * Zod schema for runtime validation of YouTube video list responses.
 */
const YouTubeVideoListResponseSchema = z.object({
  items: z.array(YouTubeVideoResponseSchema),
});

// Re-export types for consumers that import from this module
export type { YouTubeVideoSnippet, YouTubeVideoStatus, YouTubeVideoResponse };

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
    validateNonEmptyString(accessToken, 'accessToken');

    this.accessToken = accessToken;
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
    try {
      const data = await withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
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
            this.logger.error('YouTube metadata update API error', context, {
              status: response.status,
              body: errorBody,
              videoId,
            });

            if (response.status === 429) {
              const retryAfter = response.headers.get('retry-after') || undefined;
              throw new ApiError(`YouTube rate limited: ${response.status}`, response.status, retryAfter);
            }

            throw new ApiError(
              `YouTube metadata update failed: ${response.status} ${response.statusText}`,
              response.status,
            );
          }

          const rawData: unknown = await response.json();
          const parsed = YouTubeVideoResponseSchema.safeParse(rawData);
          if (!parsed.success) {
            throw new ApiError('Invalid response format from YouTube API', 500);
          }
          return parsed.data;
        } finally {
          clearTimeout(timeoutId);
        }
      }, { maxRetries: 3 });

      const latency = Date.now() - startTime;
      this.metrics.recordLatency('updateMetadata', latency, true);
      this.metrics.recordSuccess('updateMetadata');
      this.logger.info('Successfully updated YouTube metadata', context, { videoId: data.id });
      return data;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('updateMetadata', latency, false);
      this.metrics.recordError('updateMetadata', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to update YouTube metadata', context, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get video details
   */
  async getVideo(videoId: string, parts: string[] = ['snippet', 'status']): Promise<YouTubeVideoResponse> {
    const context = createRequestContext('YouTubeAdapter', 'getVideo');

    validateNonEmptyString(videoId, 'videoId');
    const startTime = Date.now();
    try {
      const data = await withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
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

          const rawData: unknown = await response.json();
          const parsed = YouTubeVideoListResponseSchema.safeParse(rawData);
          if (!parsed.success) {
            throw new ApiError('Invalid response format from YouTube API', 500);
          }
          return parsed.data;
        } finally {
          clearTimeout(timeoutId);
        }
      }, { maxRetries: 3 });

      const firstItem = data.items[0];
      if (!firstItem) {
        throw new Error(`Video not found: ${videoId}`);
      }
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('getVideo', latency, true);
      this.metrics.recordSuccess('getVideo');
      return firstItem;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('getVideo', latency, false);
      this.metrics.recordError('getVideo', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to get YouTube video', context, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Health check for YouTube API.
   * Differentiates between auth errors and service health issues.
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.short);
    try {
      const res = await fetch(`${this.baseUrl}/channels?part=id&mine=true`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      const latency = Date.now() - start;

      if (res.status === 401 || res.status === 403) {
        return {
          healthy: false,
          latency,
          error: `YouTube API authentication error: ${res.status}`,
        };
      }

      const healthy = res.ok;
      return {
        healthy,
        latency,
        error: healthy ? undefined : `YouTube API returned status ${res.status}`,
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
