import fetch from 'node-fetch';

import { API_VERSIONS, DEFAULT_TIMEOUTS, getFacebookGraphUrl } from '@config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';
import { validateNonEmptyString, validateUrl } from '../../utils/validation';
import { withRetry } from '../../utils/retry';
import { AbortController } from 'abort-controller';

/**
 * Instagram Publishing Adapter
 *
 */

/**
 * API Error with status code and retry information
 */
class ApiError extends Error {
  status: number;
  retryAfter: string | undefined;
  constructor(message: string, status: number, retryAfter?: string) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.name = 'ApiError';
  }
}

/**
 * Type guard for Instagram post response
 * @param data - Unknown data to check
 * @returns True if data has an id property
 */
function isInstagramPostResponse(data: unknown): data is { id: string } {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>)['id'] === 'string'
  );
}

// Type definitions
export interface InstagramPublishInput {
  imageUrl: string;
  caption: string;
}

export interface InstagramPublishResponse {
  id: string;
  permalink: string | undefined;
  status: 'published' | 'failed';
}

export interface InstagramMediaContainerResponse {
  id: string;
}

export interface InstagramHealthStatus {
  healthy: boolean;
  latency: number;
  error: string | undefined;
}

export class InstagramAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs = DEFAULT_TIMEOUTS.long;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(
    private readonly accessToken: string,
    private readonly igUserId: string
  ) {
    validateNonEmptyString(accessToken, 'accessToken');
    validateNonEmptyString(igUserId, 'igUserId');

    this.baseUrl = getFacebookGraphUrl(API_VERSIONS.instagram);
    this.logger = new StructuredLogger('InstagramAdapter');
    this.metrics = new MetricsCollector('InstagramAdapter');
  }

  /**
   * Publish an image to Instagram
   * @param input - Publish input containing image URL and caption
   * @returns Publish response with media ID and status
   * @throws Error if publish fails or input is invalid
   */
  async publishImage(input: InstagramPublishInput): Promise<InstagramPublishResponse> {
    const context = createRequestContext('InstagramAdapter', 'publishImage');

    validateUrl(input.imageUrl, 'imageUrl');
    validateNonEmptyString(input.caption, 'caption');

    this.logger.info('Publishing image to Instagram', context, { userId: this.igUserId });

    const startTime = Date.now();

    try {
      // Step 1: Create media container
      const containerId = await this.createMediaContainer(input, context);

      // Step 2: Publish the container
      const publishResult = await this.publishContainer(containerId, context);

      const latency = Date.now() - startTime;
      this.metrics.recordLatency('publishImage', latency, true);
      this.metrics.recordSuccess('publishImage');
      this.logger.info('Successfully published to Instagram', context, { mediaId: publishResult.id });

      const result: InstagramPublishResponse = {
        id: publishResult.id,
        permalink: undefined,
        status: 'published',
      };
      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('publishImage', latency, false);
      this.metrics.recordError('publishImage', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to publish to Instagram', context, error as Error);
      throw error;
    }
  }

  /**
   * Step 1: Create media container
   */
  private async createMediaContainer(
    input: InstagramPublishInput,
    _context: ReturnType<typeof createRequestContext>
  ): Promise<string> {
    // CORRECTNESS FIX: AbortController is created inside the retry lambda so
    // each attempt gets its own fresh controller and timeout. The previous
    // implementation created a single controller outside withRetry: once that
    // controller's timeout fired and aborted the signal, every subsequent retry
    // attempt immediately received an already-aborted signal, causing instant
    // AbortError on all retries rather than a fresh per-attempt timeout window.
    const containerRes = await withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(
          `${this.baseUrl}/${this.igUserId}/media`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              image_url: input.imageUrl,
              caption: input.caption,
            }),
            signal: controller.signal as AbortSignal,
          }
        );

        if (!res.ok) {
          if (res.status === 429) {
            const retryAfter = res.headers.get('retry-after') || undefined;
            throw new ApiError(`Instagram rate limited: ${res.status}`, res.status, retryAfter);
          }

          throw new Error(`Instagram media container failed: ${res.status} ${res.statusText}`);
        }

        return res;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('Instagram media container creation timed out');
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }, { maxRetries: 3 });

    const rawData = await containerRes.json() as unknown;
    if (!rawData || typeof rawData !== 'object' || !isInstagramPostResponse(rawData)) {
      throw new ApiError('Invalid response format from Instagram API', 500);
    }
    const data: InstagramMediaContainerResponse = rawData;

    if (!data.id) {
      throw new Error('Instagram API response missing container ID');
    }

    return data.id;
  }

  /**
   * Step 2: Publish the container
   */
  private async publishContainer(
    containerId: string,
    _context: ReturnType<typeof createRequestContext>
  ): Promise<InstagramMediaContainerResponse> {
    // CORRECTNESS FIX: same as createMediaContainer — AbortController created
    // per retry attempt so a timeout on one attempt does not kill subsequent ones.
    const publishRes = await withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(
          `${this.baseUrl}/${this.igUserId}/media_publish`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ creation_id: containerId }),
            signal: controller.signal as AbortSignal,
          }
        );

        if (!res.ok) {
          if (res.status === 429) {
            const retryAfter = res.headers.get('retry-after') || undefined;
            throw new ApiError(`Instagram rate limited: ${res.status}`, res.status, retryAfter);
          }

          throw new Error(`Instagram publish failed: ${res.status} ${res.statusText}`);
        }

        return res;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('Instagram publish timed out');
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }, { maxRetries: 3 });

    const publishRawData = await publishRes.json() as unknown;
    if (!publishRawData || typeof publishRawData !== 'object' || !isInstagramPostResponse(publishRawData)) {
      throw new ApiError('Invalid response format from Instagram API', 500);
    }
    return publishRawData as InstagramMediaContainerResponse;
  }

  /**
   * Health check for Instagram API connection
   * @returns Health status with latency and optional error message
   */
  async healthCheck(): Promise<InstagramHealthStatus> {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.short);

    try {
      // Check user info as health check
      // P2-FIX: Use Authorization header instead of query parameter for access token
      const res = await fetch(
        `${this.baseUrl}/${this.igUserId}?fields=id,username`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
          signal: controller.signal as AbortSignal,
        }
      );

      const latency = Date.now() - start;

      // Only 200-299 status codes indicate a healthy service
      const healthy = res.ok;

      const result: InstagramHealthStatus = {
        healthy,
        latency,
        error: healthy ? undefined : `Instagram API returned status ${res.status}`,
      };
      return result;
    } catch (error) {
      const result: InstagramHealthStatus = {
        healthy: false,
        latency: Date.now() - start,
        error: error instanceof Error ? error["message"] : 'Unknown error',
      };
      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
