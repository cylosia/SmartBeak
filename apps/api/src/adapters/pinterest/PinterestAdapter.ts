import { API_BASE_URLS, API_VERSIONS, DEFAULT_TIMEOUTS } from '@config';
import { AbortController } from 'abort-controller';
import { validateNonEmptyString, validateUrl } from '../../utils/validation';
import fetch from 'node-fetch';
import { withRetry } from '../../utils/retry';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';

/**
 * Pinterest Publishing Adapter
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
  retryAfter: string | undefined;
  constructor(message: string, status: number, retryAfter?: string) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.name = 'ApiError';
  }
}

/**
 * Type guard for Pinterest create pin response
 * @param data - Unknown data to check
 * @returns True if data has an id property
 */
function isPinterestPostResponse(data: unknown): data is { id: string; link: string | undefined; url: string | undefined } {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>)['id'] === 'string'
  );
}

export interface PinterestCreatePinInput {
  title: string;
  description: string | undefined;
  link: string;
  imageUrl: string;
}

export interface PinterestCreatePinResponse {
  id: string;
  link: string | undefined;
  url: string | undefined;
}

export interface PinterestErrorResponse {
  code: number | undefined;
  message: string | undefined;
}

export interface PinterestHealthStatus {
  healthy: boolean;
  latency: number;
  error: string | undefined;
}

export class PinterestAdapter {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly timeoutMs = DEFAULT_TIMEOUTS.long;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(accessToken: string) {
    this.accessToken = accessToken;

    validateNonEmptyString(accessToken, 'accessToken');

    this.baseUrl = `${API_BASE_URLS.pinterest}/${API_VERSIONS.pinterest}`;
    this.logger = new StructuredLogger('PinterestAdapter');
    this.metrics = new MetricsCollector('PinterestAdapter');
  }

  /**
   * Create a pin on Pinterest
   */
  async createPin(boardId: string, input: PinterestCreatePinInput): Promise<PinterestCreatePinResponse> {
    const context = createRequestContext('PinterestAdapter', 'createPin');

    validateNonEmptyString(boardId, 'boardId');
    validateNonEmptyString(input.title, 'title');
    validateUrl(input.link, 'link');
    validateUrl(input.imageUrl, 'imageUrl');
    this.logger.info('Creating Pinterest pin', context, { boardId, title: input.title });
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await withRetry(async () => {
        const response = await fetch(`${this.baseUrl}/pins`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            board_id: boardId,
            title: input.title,
            description: input.description,
            link: input.link,
            media_source: {
              source_type: 'image_url',
              url: input.imageUrl,
            },
          }),
          signal: controller.signal as AbortSignal,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = `Pinterest pin creation failed: ${response.status}`;
          try {
            const errorData = JSON.parse(errorBody) as PinterestErrorResponse;
            errorMessage = errorData["message"] || errorMessage;
          }
          catch {
            // Use default error message if parsing fails
          }

          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after') || undefined;
            throw new ApiError(`Pinterest rate limited: ${errorMessage}`, response.status, retryAfter);
          }
          throw new ApiError(errorMessage, response.status);
        }
        return response;
      }, { maxRetries: 3 });
      const rawData = await res.json() as unknown;
      if (!rawData || typeof rawData !== 'object' || !isPinterestPostResponse(rawData)) {
        throw new ApiError('Invalid response format from Pinterest API', 500);
      }
      const record = rawData as Record<string, unknown>;
      const data: PinterestCreatePinResponse = {
        id: record['id'] as string,
        link: record['link'] as string | undefined,
        url: record['url'] as string | undefined,
      };
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('createPin', latency, true);
      this.metrics.recordSuccess('createPin');
      this.logger.info('Successfully created Pinterest pin', context, { pinId: data.id });
      return data;
    }
    catch (error) {
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('createPin', latency, false);
      this.metrics.recordError('createPin', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to create Pinterest pin', context, error as Error);
      throw error;
    }
    finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * MEDIUM FIX M7: Health check for Pinterest API
   */
  async healthCheck(): Promise<PinterestHealthStatus> {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.short);
    try {
      // Check user info as health check
      const res = await fetch(`${this.baseUrl}/user_account`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json',
        },
        signal: controller.signal as AbortSignal,
      });
      const latency = Date.now() - start;
      const healthy = res.ok;  // Remove || res.status === 401
      const result: PinterestHealthStatus = {
        healthy,
        latency,
        error: healthy ? undefined : `Pinterest API returned status ${res.status}`,
      };
      return result;
    }
    catch (error) {
      const result: PinterestHealthStatus = {
        healthy: false,
        latency: Date.now() - start,
        error: error instanceof Error ? error["message"] : 'Unknown error',
      };
      return result;
    }
    finally {
      clearTimeout(timeoutId);
    }
  }
}
