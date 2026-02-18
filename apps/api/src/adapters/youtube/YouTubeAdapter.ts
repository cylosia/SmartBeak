import fetch from 'node-fetch';
import { z } from 'zod';

import { API_BASE_URLS, API_VERSIONS, DEFAULT_TIMEOUTS } from '@config';
import { getLogger } from '@kernel/logger';
import { withRetry, CircuitBreaker } from '@kernel/retry';
import { ValidationError, NotFoundError, ErrorCodes } from '@errors';

import { ApiError } from '../../errors/ApiError';
import { sanitizeVideoIdForLog } from '../../utils/sanitize';
import { validateNonEmptyString } from '../../utils/validation';
import type { CanaryAdapter } from '../../canaries/types';

// Re-export ApiError so consumers can perform instanceof checks without
// importing from the internal errors path directly.
export { ApiError } from '../../errors/ApiError';

/**
 * YouTube Publishing Adapter
 *
 * Audit fixes applied (all prior + this cycle):
 *   P0-1  error body try-catch
 *   P0-2  removed dimensions from Analytics request
 *   P1-1  (analytics) ApiError 500→422 for schema failures
 *   P1-2  token factory for OAuth token refresh
 *   P1-3  ApiError moved to shared errors/ApiError.ts
 *   P1-4  empty parts[] validation; videoId regex in getVideo/updateMetadata
 *   P1-6  parts allowlist
 *   P2-1  health check body consumption
 *   P2-2  sanitizeVideoIdForLog shared & consistent
 *   P2-3  healthCheck 403 body parsed via Zod schema instead of `as` cast
 *   P2-4  migrated from StructuredLogger to getLogger — logger.error 3-arg form
 *   P2-5  AppError subclasses (ValidationError, NotFoundError) instead of raw Error
 *   P2-6  CircuitBreaker wraps all retry calls
 *   P2-7  healthCheck accepts AbortSignal; cache healthy results for 60 s
 *   P2-8  AbortSignal threaded through public methods into withRetry
 *   P3-2  comment explaining double clearTimeout in updateMetadata
 *   P3-4  videoId regex applied in both updateMetadata and getVideo
 */

// ── Module-level logger (CLAUDE.md mandates getLogger from @kernel/logger) ──
const logger = getLogger('YouTubeAdapter');

// ── Zod schemas ──────────────────────────────────────────────────────────────

/**
 * Single source of truth for YouTube video responses.
 * TypeScript type is z.infer-derived to prevent drift.
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

/** Type derived from Zod schema — single source of truth */
export type YouTubeVideoResponse = z.infer<typeof YouTubeVideoResponseSchema>;

/** Snippet fields from YouTube video response */
export type YouTubeVideoSnippet = NonNullable<YouTubeVideoResponse['snippet']>;

/** Status fields from YouTube video response */
export type YouTubeVideoStatus = NonNullable<YouTubeVideoResponse['status']>;

/**
 * Changed from passthrough() to strip(). Pagination fields (pageInfo,
 * nextPageToken) are not used; strip prevents untrusted arbitrary properties
 * from flowing through.
 */
const YouTubeVideoListResponseSchema = z.object({
  items: z.array(YouTubeVideoResponseSchema),
}).strip();

/**
 * P2-3 FIX: Zod schema for 403 error body so we can safely extract `reason`
 * without an unsafe `as` cast.
 */
const YouTubeErrorBodySchema = z.object({
  error: z.object({
    errors: z.array(z.object({
      reason: z.string().optional(),
    })).optional(),
  }).optional(),
});

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
  error?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Allowlist of valid YouTube Data API part names.
 * Prevents quota abuse via arbitrary part requests.
 */
const VALID_VIDEO_PARTS = new Set([
  'snippet', 'status', 'contentDetails', 'statistics',
  'player', 'topicDetails', 'recordingDetails', 'localizations',
]);

/**
 * P3-4 FIX: YouTube video IDs are exactly 11 base64url characters.
 * Applied in both updateMetadata and getVideo for consistent validation.
 */
const YOUTUBE_VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

/** TTL for caching successful health check results — reduces quota burn */
const HEALTHY_CACHE_TTL_MS = 60_000;

// ── Adapter class ────────────────────────────────────────────────────────────

/** P2-5 FIX: Explicit implements CanaryAdapter for compile-time contract enforcement */
export class YouTubeAdapter implements CanaryAdapter {
  /** P1-2 FIX: Token factory supports OAuth token refresh for long-running workers */
  private readonly getAccessToken: () => string | Promise<string>;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  /**
   * P2-6 FIX: Circuit breaker prevents quota-burn cascade when the YouTube API
   * is down or quota-banned. After 5 consecutive failures the breaker opens,
   * fast-failing all calls for 60 s instead of making live HTTP requests.
   */
  private readonly circuitBreaker: CircuitBreaker;
  /**
   * P2-1 FIX: TTL cache for healthy healthCheck results. Only caches healthy
   * outcomes so unhealthy state bypasses the cache for rapid recovery detection.
   */
  private lastHealthCheck?: { result: HealthCheckResult; ts: number } | undefined;

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
    this.circuitBreaker = new CircuitBreaker('youtube-api', {
      failureThreshold: 5,
      resetTimeoutMs: 60_000,
    });
  }

  /**
   * Update video snippet metadata.
   *
   * P2-8 FIX: Optional signal propagated to withRetry so an outer cancellation
   * (e.g. Fastify request timeout, canary abort) stops the retry loop promptly
   * rather than letting it run for up to maxRetries × timeoutMs = 90 s.
   */
  async updateMetadata(
    videoId: string,
    metadata: YouTubeVideoMetadata,
    signal?: AbortSignal,
  ): Promise<YouTubeVideoResponse> {
    validateNonEmptyString(videoId, 'videoId');

    // P3-4 FIX: Consistent format validation matching youtubeAnalytics.ts
    if (!YOUTUBE_VIDEO_ID_REGEX.test(videoId)) {
      throw new ValidationError(
        'videoId must be an 11-character YouTube video ID',
        ErrorCodes.VALIDATION_ERROR,
      );
    }

    logger.info('Updating YouTube video metadata', {
      operation: 'updateMetadata',
      videoId: sanitizeVideoIdForLog(videoId),
    });

    const startTime = Date.now();
    try {
      // P2-6 FIX: Circuit breaker wraps the retry block
      const data = await this.circuitBreaker.execute(async () =>
        withRetry(async () => {
          // P1-2 FIX: Token fetched inside retry so factory provides a fresh
          // token on each attempt (e.g. after 429 backoff)
          const accessToken = await this.getAccessToken();
          validateNonEmptyString(accessToken, 'accessToken');

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

          // P2-8 FIX: Abort inner controller when outer signal fires
          const onOuterAbort = () => controller.abort();
          signal?.addEventListener('abort', onOuterAbort, { once: true });

          try {
            const response = await fetch(`${this.baseUrl}/videos?part=snippet`, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify({ id: videoId, snippet: metadata }),
              signal: controller.signal,
            });

            if (!response.ok) {
              // P0-1 FIX: Wrap response.text() in try-catch to avoid masking
              // the HTTP status when the stream is interrupted
              let errorBody = '';
              try { errorBody = await response.text(); } catch { /* body unreadable */ }
              logger.error(
                'YouTube metadata update API error',
                new Error(`HTTP ${response.status}`),
                {
                  operation: 'updateMetadata',
                  status: response.status,
                  body: errorBody.slice(0, 1024),
                  videoId: sanitizeVideoIdForLog(videoId),
                },
              );

              if (response.status === 429) {
                const retryAfter = response.headers.get('retry-after') ?? undefined;
                throw new ApiError(
                  `YouTube rate limited: ${response.status}`,
                  response.status,
                  retryAfter,
                  errorBody,
                );
              }
              throw new ApiError(
                `YouTube metadata update failed: ${response.status} ${response.statusText}`,
                response.status,
                undefined,
                errorBody,
              );
            }

            // P3-2 FIX: Clear timeout before parsing body. For non-idempotent
            // PUT operations, an abort during json() would trigger a retry of a
            // mutation that already succeeded on the server. The finally below
            // is still needed as a safety net for error paths that skip this line.
            clearTimeout(timeoutId);
            // Audit fix: detach the outer-signal listener before reading the
            // body. The timeout is now cleared, but the outer AbortSignal
            // listener is still attached until the finally block runs. If the
            // outer signal fires during response.json(), it aborts the inner
            // controller, throws AbortError, and withRetry could re-execute a
            // PUT that already committed server-side. Removing it here — on the
            // success path, before json() — closes this window entirely. The
            // finally block's removeEventListener call becomes a no-op (safe).
            signal?.removeEventListener('abort', onOuterAbort);
            const rawData: unknown = await response.json();
            const parsed = YouTubeVideoResponseSchema.safeParse(rawData);
            if (!parsed.success) {
              // 422 is non-retryable — retrying won't change the response shape
              throw new ApiError('Invalid response format from YouTube API', 422);
            }
            return parsed.data;
          } finally {
            // Redundant on the success path (timeout already cleared above) but
            // ensures cleanup on all error paths that throw before line above.
            clearTimeout(timeoutId);
            signal?.removeEventListener('abort', onOuterAbort);
          }
        }, { maxRetries: 3, ...(signal !== undefined ? { signal } : {}) }),
      signal);

      const latencyMs = Date.now() - startTime;
      logger.info('Successfully updated YouTube metadata', {
        operation: 'updateMetadata',
        // Audit fix: sanitize response id just as error paths sanitize caller
        // input — the YouTube API response is an untrusted string that has not
        // been validated against YOUTUBE_VIDEO_ID_REGEX and must not reach
        // structured logs raw (log-injection / PII consistency).
        videoId: sanitizeVideoIdForLog(data.id),
        latencyMs,
      });
      return data;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      logger.error(
        'Failed to update YouTube metadata',
        error instanceof Error ? error : new Error(String(error)),
        { operation: 'updateMetadata', latencyMs },
      );
      throw error;
    }
  }

  /**
   * Get video details.
   *
   * P2-8 FIX: Optional signal propagated to withRetry and inner fetch.
   */
  async getVideo(
    videoId: string,
    parts: string[] = ['snippet', 'status'],
    signal?: AbortSignal,
  ): Promise<YouTubeVideoResponse> {
    validateNonEmptyString(videoId, 'videoId');

    // P3-4 FIX: Consistent format validation
    if (!YOUTUBE_VIDEO_ID_REGEX.test(videoId)) {
      throw new ValidationError(
        'videoId must be an 11-character YouTube video ID',
        ErrorCodes.VALIDATION_ERROR,
      );
    }

    // P1-6 FIX: Validate parts against allowlist to prevent quota abuse
    if (parts.length === 0) {
      // P1-4 FIX: Empty parts array sends part= which is always a 400 from YouTube
      throw new ValidationError(
        'parts array must contain at least one valid part name',
        ErrorCodes.VALIDATION_ERROR,
      );
    }
    for (const part of parts) {
      if (!VALID_VIDEO_PARTS.has(part)) {
        throw new ValidationError(
          `Invalid YouTube API part: ${part}. Allowed: ${[...VALID_VIDEO_PARTS].join(', ')}`,
          ErrorCodes.VALIDATION_ERROR,
        );
      }
    }

    const startTime = Date.now();
    try {
      // P2-6 FIX: Circuit breaker wraps the retry block
      const data = await this.circuitBreaker.execute(async () =>
        withRetry(async () => {
          const accessToken = await this.getAccessToken();
          validateNonEmptyString(accessToken, 'accessToken');

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

          const onOuterAbort = () => controller.abort();
          signal?.addEventListener('abort', onOuterAbort, { once: true });

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
              let errorBody = '';
              try { errorBody = await response.text(); } catch { /* body unreadable */ }
              logger.error(
                'YouTube get video API error',
                new Error(`HTTP ${response.status}`),
                {
                  operation: 'getVideo',
                  status: response.status,
                  body: errorBody.slice(0, 1024),
                  videoId: sanitizeVideoIdForLog(videoId),
                },
              );

              if (response.status === 429) {
                const retryAfter = response.headers.get('retry-after') ?? undefined;
                throw new ApiError(
                  `YouTube rate limited: ${response.status}`,
                  response.status,
                  retryAfter,
                  errorBody,
                );
              }
              throw new ApiError(
                `YouTube get video failed: ${response.status}`,
                response.status,
                undefined,
                errorBody,
              );
            }

            const rawData: unknown = await response.json();
            const parsed = YouTubeVideoListResponseSchema.safeParse(rawData);
            if (!parsed.success) {
              throw new ApiError('Invalid response format from YouTube API', 422);
            }
            return parsed.data;
          } finally {
            clearTimeout(timeoutId);
            signal?.removeEventListener('abort', onOuterAbort);
          }
        }, { maxRetries: 3, ...(signal !== undefined ? { signal } : {}) }),
      signal);

      if (data.items.length > 1) {
        logger.warn('YouTube returned multiple items for single videoId', {
          operation: 'getVideo',
          videoId: sanitizeVideoIdForLog(videoId),
          itemCount: data.items.length,
        });
      }

      const firstItem = data.items[0];
      if (!firstItem) {
        // P2-5 FIX: NotFoundError instead of raw Error
        throw new NotFoundError(
          `Video not found: ${sanitizeVideoIdForLog(videoId)}`,
          ErrorCodes.NOT_FOUND,
        );
      }

      const latencyMs = Date.now() - startTime;
      logger.info('Successfully retrieved YouTube video', {
        operation: 'getVideo',
        // Audit fix: sanitize API-response id for log-injection consistency.
        videoId: sanitizeVideoIdForLog(firstItem.id),
        latencyMs,
      });
      return firstItem;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      logger.error(
        'Failed to get YouTube video',
        error instanceof Error ? error : new Error(String(error)),
        { operation: 'getVideo', latencyMs },
      );
      throw error;
    }
  }

  /**
   * Health check for YouTube API.
   *
   * P2-1 FIX: Caches healthy results for HEALTHY_CACHE_TTL_MS (60 s) to avoid
   * burning quota units on every canary poll. Unhealthy results bypass the
   * cache so recovery is detected promptly.
   *
   * P2-3 FIX: 403 body parsed via Zod instead of unsafe `as` cast.
   *
   * P2-7 FIX: Accepts an optional AbortSignal so the canary runner can cancel
   * an in-progress check when its own outer timeout fires.
   */
  async healthCheck(signal?: AbortSignal): Promise<HealthCheckResult> {
    // Serve from cache if last result was healthy and within TTL
    if (
      this.lastHealthCheck &&
      this.lastHealthCheck.result.healthy &&
      Date.now() - this.lastHealthCheck.ts < HEALTHY_CACHE_TTL_MS
    ) {
      return this.lastHealthCheck.result;
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.short);

    // P2-7 FIX: Abort inner controller when outer signal fires
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const accessToken = await this.getAccessToken();
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

      // Always consume response body to prevent TCP connection leak
      let responseBody = '';
      try { responseBody = await res.text(); } catch { /* body unreadable */ }

      if (res.status === 401) {
        return { healthy: false, latency, error: `YouTube API authentication error: ${res.status}` };
      }

      // P2-3 FIX: 403 can mean quota exceeded, IP blocked, or auth — differentiate.
      // Use Zod schema instead of `as` cast to safely extract the reason field.
      if (res.status === 403) {
        let reason = 'forbidden';
        try {
          const bodyParsed = YouTubeErrorBodySchema.safeParse(JSON.parse(responseBody));
          if (bodyParsed.success) {
            const rawReason = bodyParsed.data?.error?.errors?.[0]?.reason;
            reason = rawReason ? rawReason.replace(/[^\w]/g, '_').slice(0, 50) : 'forbidden';
          }
        } catch { /* unparseable body */ }
        return { healthy: false, latency, error: `YouTube API 403 error (reason: ${reason})` };
      }

      const healthy = res.ok;
      if (healthy) {
        const result: HealthCheckResult = { healthy, latency };
        // Cache only healthy results; unhealthy state bypasses cache
        this.lastHealthCheck = { result, ts: Date.now() };
        return result;
      }
      // Clear stale cache when API becomes unhealthy
      this.lastHealthCheck = undefined;
      return { healthy, latency, error: `YouTube API returned status ${res.status}` };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }
}
