import fetch from 'node-fetch';
import { z } from 'zod';

import { API_BASE_URLS, API_VERSIONS, DEFAULT_TIMEOUTS } from '@config';

import { withRetry } from '../../utils/retry';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';
import { validateNonEmptyString } from '../../utils/validation';
import type { CanaryAdapter } from '../../canaries/types';

/**
 * YouTube Publishing Adapter
 *
 * Security audit 1: P0-1 (error body try-catch), P1-2 (HealthCheckResult),
 *   P1-6 (parts allowlist), P1-7 (Zod-derived types), P2-1 (body consumption),
 *   P2-2 (body truncation), P2-6 (videoId sanitization), P2-7 (403 clarity),
 *   P2-11 (readonly fields), P3-2 (ApiError exported), P3-3 (strip)
 *
 * Security audit 2: P1-1 (getVideo body consumption), P1-2 (token factory),
 *   P2-3 (strip), P2-5 (implements CanaryAdapter), P3-5 (multi-item warn),
 *   P3-6 (ApiError carries body)
 *
 * Security audit 3: P1-1 (token validation), P1-2 (token per retry),
 *   P1-3 (clearTimeout before body parse), P2-1 (422 for schema errors),
 *   P2-6 (errorBody in updateMetadata), P3-4 (empty sanitization),
 *   P3-8 (reason sanitization)
 */

/**
 * API Error with status code and retry information.
 * P3-2 FIX: Exported so consumers can use instanceof for typed error handling.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfter?: string | undefined;
  /** P3-6 FIX: Truncated response body for debugging without memory risk */
  readonly responseBody?: string | undefined;
  constructor(message: string, status: number, retryAfter?: string | undefined, responseBody?: string | undefined) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.responseBody = responseBody?.slice(0, 1024);
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
 * P2-3 FIX (audit 2): Changed from passthrough() to strip(). Pagination fields
 * (pageInfo, nextPageToken) are not used; strip prevents untrusted arbitrary
 * properties from flowing through. Add fields explicitly if pagination is needed.
 */
const YouTubeVideoListResponseSchema = z.object({
  items: z.array(YouTubeVideoResponseSchema),
}).strip();

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
  // P3-4 FIX (audit 3): Return placeholder when sanitization strips all chars
  const sanitized = videoId.slice(0, MAX_VIDEO_ID_LOG_LENGTH).replace(/[^\w-]/g, '');
  return sanitized || '<invalid>';
}

/** P2-5 FIX: Explicit implements CanaryAdapter for compile-time contract enforcement */
export class YouTubeAdapter implements CanaryAdapter {
  // P2-11 FIX: All private fields marked readonly
  /**
   * P1-2 FIX (audit 2): Token factory supports both static tokens and lazy
   * resolution for OAuth token refresh. YouTube tokens expire after 1 hour;
   * long-running workers must use a factory to avoid silent 401 failures.
   */
  private readonly getAccessToken: () => string | Promise<string>;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(accessTokenOrFactory: string | (() => string | Promise<string>)) {
    if (typeof accessTokenOrFactory === 'string') {
      validateNonEmptyString(accessTokenOrFactory, 'accessToken');
      const token = accessTokenOrFactory;
      this.getAccessToken = () => token;
    } else {
      this.getAccessToken = accessTokenOrFactory;
    }

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
        // P1-2 FIX (audit 3): Token fetched inside retry so factory can
        // provide a fresh token on each attempt (e.g., after 429 backoff).
        const accessToken = await this.getAccessToken();
        // P1-1 FIX (audit 3): Validate factory-returned token to prevent
        // silent `Bearer ` / `Bearer null` Authorization headers.
        validateNonEmptyString(accessToken, 'accessToken');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const response = await fetch(`${this.baseUrl}/videos?part=snippet`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
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
              // P2-6 FIX (audit 3): Pass errorBody for debugging parity with getVideo
              throw new ApiError(`YouTube rate limited: ${response.status}`, response.status, retryAfter, errorBody);
            }

            // P2-6 FIX (audit 3): Pass errorBody for debugging parity with getVideo
            throw new ApiError(
              `YouTube metadata update failed: ${response.status} ${response.statusText}`,
              response.status,
              undefined,
              errorBody,
            );
          }

          // P1-3 FIX (audit 3): Clear timeout before parsing body. For non-idempotent
          // PUT operations, an abort during json() would trigger a retry of a mutation
          // that already succeeded on the server. Clearing here means only the network
          // request phase is abortable, not the body parsing phase.
          clearTimeout(timeoutId);
          const rawData: unknown = await response.json();
          const parsed = YouTubeVideoResponseSchema.safeParse(rawData);
          if (!parsed.success) {
            // P2-1 FIX (audit 3): Use 422 (non-retryable) instead of 500 for schema
            // validation failures. Retrying won't change the response shape.
            throw new ApiError('Invalid response format from YouTube API', 422);
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
        // P1-2 FIX (audit 3): Token fetched inside retry for fresh token on each attempt
        const accessToken = await this.getAccessToken();
        // P1-1 FIX (audit 3): Validate factory-returned token
        validateNonEmptyString(accessToken, 'accessToken');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const url = new URL(`${this.baseUrl}/videos`);
          url.searchParams.append('id', videoId);
          url.searchParams.append('part', parts.join(','));
          const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json',
            },
            signal: controller.signal,
          });

          if (!response.ok) {
            // P1-1 FIX (audit 2): Consume response body to prevent TCP connection leak.
            // node-fetch holds connections open for unconsumed bodies. Under sustained
            // quota errors, this exhausts the connection pool within minutes.
            let errorBody = '';
            try { errorBody = await response.text(); } catch { /* body unreadable */ }
            this.logger.error('YouTube get video API error', context, new Error(`HTTP ${response.status}`), {
              status: response.status,
              body: errorBody.slice(0, 1024),
              videoId: sanitizeVideoIdForLog(videoId),
            });

            if (response.status === 429) {
              const retryAfter = response.headers.get('retry-after') || undefined;
              throw new ApiError(`YouTube rate limited: ${response.status}`, response.status, retryAfter, errorBody);
            }
            throw new ApiError(`YouTube get video failed: ${response.status}`, response.status, undefined, errorBody);
          }

          const rawData: unknown = await response.json();
          const parsed = YouTubeVideoListResponseSchema.safeParse(rawData);
          if (!parsed.success) {
            // P2-1 FIX (audit 3): Use 422 (non-retryable) for schema validation failures
            throw new ApiError('Invalid response format from YouTube API', 422);
          }
          return parsed.data;
        } finally {
          clearTimeout(timeoutId);
        }
      }, { maxRetries: 3 });

      // P3-5 FIX: Warn when YouTube returns multiple items for a single videoId
      if (data.items.length > 1) {
        this.logger.warn('YouTube returned multiple items for single videoId', context, {
          videoId: sanitizeVideoIdForLog(videoId),
          itemCount: data.items.length,
        });
      }

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
      const accessToken = await this.getAccessToken();
      // P1-1 FIX (audit 3): Validate factory-returned token
      validateNonEmptyString(accessToken, 'accessToken');
      const res = await fetch(`${this.baseUrl}/channels?part=id&mine=true`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
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
          // P3-8 FIX (audit 3): Sanitize reason to prevent log injection
          const rawReason = body?.error?.errors?.[0]?.reason;
          reason = rawReason ? rawReason.replace(/[^\w]/g, '_').slice(0, 50) : 'forbidden';
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
