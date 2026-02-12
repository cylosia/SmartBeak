import fetch from 'node-fetch';

import { apiConfig, timeoutConfig } from '@config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';
import { validateNonEmptyString, isFacebookErrorResponse, isFacebookPostResponse } from '@kernel/validation';
import { withRetry } from '@kernel/retry';




/**
* Facebook Publishing Adapter
*
*/

// Type definitions
export interface FacebookPostResponse {
  id: string;
  post_id?: string | undefined;
}

export class FacebookAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs = timeoutConfig.long;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(private readonly accessToken: string) {
  validateNonEmptyString(accessToken, 'accessToken');

  this.baseUrl = `${apiConfig.baseUrls.facebook}/${apiConfig.versions.facebook}`;
  this.logger = new StructuredLogger('FacebookAdapter');
  this.metrics = new MetricsCollector('FacebookAdapter');
  }

  /**
  * Publish a post to a Facebook page
  */
  async publishPagePost(pageId: string, message: string): Promise<FacebookPostResponse> {
  const context = createRequestContext('FacebookAdapter', 'publishPagePost');

  validateNonEmptyString(pageId, 'pageId');
  validateNonEmptyString(message, 'message');

  this.logger.info('Publishing to Facebook page', context, { pageId });

  const startTime = Date.now();

  // P1-3 FIX: AbortController was previously created OUTSIDE withRetry.
  // Once the timeout fired on the first attempt and aborted the signal,
  // all subsequent retries would instantly throw AbortError because they
  // shared the same permanently-aborted signal. Now each retry attempt
  // gets its own AbortController with a fresh timeout.

  try {
    const res = await withRetry(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
    const response = await fetch(
    `${this.baseUrl}/${pageId}/feed`,
    {
    method: 'POST',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${this.accessToken}`,
    },
    body: new URLSearchParams({ message }),
    signal: controller.signal,
    }
    );

    if (!response.ok) {
    const errorBody = await response.text();

    if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    const rateLimitError = Object.assign(
        new Error(`Facebook rate limited: ${response.status}`),
        { status: response.status, retryAfter: retryAfter || undefined }
    );
    throw rateLimitError;
    }

    throw new Error(`Facebook publish failed: ${response.status} ${response.statusText}`);
    }

    return response;
    } finally {
    clearTimeout(timeoutId);
    }
    }, { maxRetries: 3 });

    const rawData = await res.json() as unknown;

    // P1-4 FIX: Validate response shape with type guard instead of raw cast.
    // Previously used `as FacebookPostResponse` which silently accepted any JSON.
    // If Facebook returns unexpected data (e.g., { error: ... } on 200), this
    // would produce malformed data downstream.
    if (!isFacebookPostResponse(rawData)) {
    throw new Error('Invalid response format from Facebook API');
    }

    const data: FacebookPostResponse = {
    id: rawData.id,
    post_id: (rawData as Record<string, unknown>)['post_id'] as string | undefined,
    };

    const latency = Date.now() - startTime;
    this.metrics.recordLatency('publishPagePost', latency, true);
    this.metrics.recordSuccess('publishPagePost');
    this.logger.info('Successfully published to Facebook', context, { postId: data.id });

    return data;
  } catch (error) {
    const latency = Date.now() - startTime;
    this.metrics.recordLatency('publishPagePost', latency, false);
    this.metrics.recordError('publishPagePost', error instanceof Error ? error.name : 'Unknown');
    this.logger.error('Failed to publish to Facebook', context, error as Error);
    throw error;
  }
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string | undefined }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutConfig.short);

  try {
    // Check user info as health check
    const res = await fetch(
    `${this.baseUrl}/me`,
    {
    method: 'GET',
    headers: {
        'Authorization': `Bearer ${this.accessToken}`,
    },
    signal: controller.signal,
    }
    );

    const latency = Date.now() - start;

    // Only 200-299 status codes indicate a healthy service
    const healthy = res.ok;

    return {
    healthy,
    latency,
    error: healthy ? undefined : `Facebook API returned status ${res.status}`,
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
