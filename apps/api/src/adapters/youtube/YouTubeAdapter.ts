import { z } from 'zod';
import { API_BASE_URLS, API_VERSIONS, DEFAULT_TIMEOUTS } from '@config';
import { validateNonEmptyString } from '../../utils/validation';
import fetch from 'node-fetch';
import { withRetry } from '../../utils/retry';
import { StructuredLogger, createRequestContext, MetricsCollector } from '../../utils/request';

/**
 * YouTube Publishing Adapter
 *
 * Security audit fixes applied:
 * - P0-1: response.text() in error path wrapped in try-catch
 * - P1-2: HealthCheckResult aligned with CanaryAdapter interface
 * - P1-6: parts parameter validated against allowlist
 * - P1-7: YouTubeVideoResponse derived from Zod schema via z.infer
 * - P2-1: healthCheck() consumes response body to prevent connection leak
 * - P2-2: Error body truncated to prevent credential leakage in logs
 * - P2-6: videoId sanitized in error messages
 * - P2-7: healthCheck 403 error message clarified
 * - P2-11: Private fields marked readonly
 * - P3-2: ApiError exported
 * - P3-3: YouTubeVideoListResponseSchema uses passthrough()
 */

/**
 * API Error with status code and retry information.
 * P3-2 FIX: Exported so consumers can use instanceof for typed error handling.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfter?: string | undefined;
  constructor(message: string, status: number, retryAfter?: string | undefined) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.name = this.constructor.name;
  }
}

/**
 * P1-7 FIX: Zod schema is the single source of truth for YouTube video responses.
 * The TypeScript type is derived via z.infer to prevent drift.
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

/** P1-7 FIX: Type derived from Zod schema -- single source of truth */
export type YouTubeVideoResponse = z.infer<typeof YouTubeVideoResponseSchema>;

/** Snippet fields from YouTube video response */
export type YouTubeVideoSnippet = NonNullable<YouTubeVideoResponse['snippet']>;

/** Status fields from YouTube video response */
export type YouTubeVideoStatus = NonNullable<YouTubeVideoResponse['status']>;

/**
 * P3-3 FIX: passthrough() preserves pagination fields (pageInfo, nextPageToken)
 * that YouTube API returns but we don't currently use.
 */
const YouTubeVideoListResponseSchema = z.object({
  items: z.array(YouTubeVideoResponseSchema),
}).passthrough();

export interface YouTubeVideoMetadata {
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  defaultLanguage?: string;
}

/**
 * P1-2 FIX: Changed error from `string | undefined` to `string` to match
 * CanaryAdapter interface under exactOptionalPropertyTypes. When healthy,
 * the property is omitted entirely rather than set to `undefined`.
 */
export interface HealthCheckResult {
  healthy: boolean;
  latency: number;
  error?: string;
}

/**
 * P1-6 FIX: Allowlist of valid YouTube Data API part names.
 * Prevents quota abuse via arbitrary part requests.
 */
const VALID_VIDEO_PARTS = new Set([
  'snippet', 'status', 'contentDetails', 'statistics',
  'player', 'topicDetails', 'recordingDetails', 'localizations',
]);

/** P2-6: Max length for videoId in error messages to prevent log injection */
const MAX_VIDEO_ID_LOG_LENGTH = 20;

function sanitizeVideoIdForLog(videoId: string): string {
  return videoId.slice(0, MAX_VIDEO_ID_LOG_LENGTH).replace(/[^\w-]/g, '');
}

export class YouTubeAdapter {
  // P2-11 FIX: All private fields marked readonly
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(accessToken: string) {
    validateNonEmptyString(accessToken, 'accessToken');

    this.accessToken = accessToken;
    this.baseUrl = `${API_BASE_URLS.youtube}/${API_VERSIONS.youtube}`;
    this.timeoutMs = DEFAULT_TIMEOUTS.long;
    this.logger = new StructuredLogger('YouTubeAdapter');
    this.metrics = new MetricsCollector('YouTubeAdapter');
  }

  /**
   * Update video snippet metadata
   */
  async updateMetadata(videoId: string, metadata: YouTubeVideoMetadata): Promise<YouTubeVideoResponse> {
    const context = createRequestContext('YouTubeAdapter', 'updateMetadata');

    validateNonEmptyString(videoId, 'videoId');
    this.logger.info('Updating YouTube video metadata', context, { videoId: sanitizeVideoIdForLog(videoId) });
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
            // P0-1 FIX: Wrap response.text() in try-catch to prevent masking
            // the HTTP status code. If text() throws (network reset, abort,
            // stream corruption), we lose the body but preserve the status.
            let errorBody = '';
            try { errorBody = await response.text(); } catch { /* body unreadable */ }
            this.logger.error('YouTube metadata update API error', context, new Error(`HTTP ${response.status}`), {
              status: response.status,
              // P2-2 FIX: Truncate error body to prevent credential leakage
              body: errorBody.slice(0, 1024),
              videoId: sanitizeVideoIdForLog(videoId),
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

    // P1-6 FIX: Validate parts against allowlist to prevent quota abuse
    for (const part of parts) {
      if (!VALID_VIDEO_PARTS.has(part)) {
        throw new Error(`Invalid YouTube API part: ${part}. Allowed: ${[...VALID_VIDEO_PARTS].join(', ')}`);
      }
    }

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
        // P2-6 FIX: Sanitize videoId in error messages
        throw new Error(`Video not found: ${sanitizeVideoIdForLog(videoId)}`);
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
   * P2-7 FIX: Differentiates between auth errors and other 403 reasons (quota, IP block).
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

      // P2-1 FIX: Always consume the response body to prevent connection leak.
      // node-fetch v3 uses Web Streams; unconsumed bodies hold TCP connections.
      let responseBody = '';
      try { responseBody = await res.text(); } catch { /* body unreadable */ }

      if (res.status === 401) {
        return {
          healthy: false,
          latency,
          error: `YouTube API authentication error: ${res.status}`,
        };
      }

      // P2-7 FIX: 403 can mean quota exceeded, IP blocked, or auth — differentiate
      if (res.status === 403) {
        let reason = 'forbidden';
        try {
          const body = JSON.parse(responseBody) as { error?: { errors?: Array<{ reason?: string }> } };
          reason = body?.error?.errors?.[0]?.reason ?? 'forbidden';
        } catch { /* unparseable body */ }
        return {
          healthy: false,
          latency,
          error: `YouTube API 403 error (reason: ${reason})`,
        };
      }

      const healthy = res.ok;
      // P1-2 FIX: Omit error property entirely when healthy, instead of
      // setting it to undefined. This satisfies exactOptionalPropertyTypes.
      if (healthy) {
        return { healthy, latency };
      }
      return {
        healthy,
        latency,
        error: `YouTube API returned status ${res.status}`,
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
