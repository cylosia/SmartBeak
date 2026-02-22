import fetch from 'node-fetch';

import { apiConfig } from '@config';
import { validateNonEmptyString, isFacebookPostResponse } from '@kernel/validation';
import { withRetry } from '@kernel/retry';
import { validateUrlWithDns } from '@security/ssrf';
import type { PublishAdapter, PublishInput } from '@domain/publishing/application/ports/PublishAdapter';

import { BaseExternalAdapter } from '../base';


/**
 * Facebook Publishing Adapter
 */

export interface FacebookPostResponse {
  id: string;
  post_id?: string | undefined;
}

export class FacebookAdapter extends BaseExternalAdapter implements PublishAdapter {
  private readonly baseUrl: string;

  constructor(private readonly accessToken: string) {
    super('FacebookAdapter');
    validateNonEmptyString(accessToken, 'accessToken');
    this.baseUrl = `${apiConfig.baseUrls.facebook}/${apiConfig.versions.facebook}`;
  }

  /**
   * Publish a post to a Facebook page
   */
  async publishPagePost(pageId: string, message: string): Promise<FacebookPostResponse> {
    validateNonEmptyString(pageId, 'pageId');
    validateNonEmptyString(message, 'message');

    return this.instrumented('publishPagePost', async (context) => {
      // SSRF protection: validate the constructed URL before making the outbound request
      const targetUrl = `${this.baseUrl}/${pageId}/feed`;
      const ssrfCheck = await validateUrlWithDns(targetUrl);
      if (!ssrfCheck.allowed) {
        this.logger.error('SSRF check failed for Facebook API URL', context, {
          reason: ssrfCheck.reason,
        });
        throw new Error('Facebook API request blocked by security policy');
      }

      const res = await withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Bearer ${this.accessToken}`,
            },
            body: new URLSearchParams({ message }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const _errorBody = await response.text();

            if (response.status === 429) {
              throw this.createRateLimitError('Facebook', response.status, response.headers);
            }

            throw new Error(`Facebook publish failed: ${response.status} ${response.statusText}`);
          }

          return response;
        } finally {
          clearTimeout(timeoutId);
        }
      }, { maxRetries: 3 });

      const rawData = await res.json() as unknown;

      if (!isFacebookPostResponse(rawData)) {
        throw new Error('Invalid response format from Facebook API');
      }

      const data: FacebookPostResponse = {
        id: rawData.id,
        ...(rawData.post_id !== undefined ? { post_id: rawData.post_id } : {}),
      };

      this.logger.info('Successfully published to Facebook', context, { postId: data.id });
      return data;
    }, { pageId });
  }

  /**
   * Publish content via the PublishAdapter interface.
   */
  async publish(input: PublishInput): Promise<void> {
    const pageId = input.targetConfig.options?.['pageId'];
    if (typeof pageId !== 'string' || !pageId) {
      throw new Error('Facebook publish requires targetConfig.options.pageId');
    }
    if (!/^\d+$/.test(pageId)) {
      throw new Error('Facebook publish requires targetConfig.options.pageId to be a numeric string');
    }
    const message = input.targetConfig.options?.['message'];
    if (typeof message !== 'string' || !message) {
      throw new Error('Facebook publish requires targetConfig.options.message');
    }
    await this.publishPagePost(pageId, message);
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string | undefined }> {
    return this.healthProbe(async (signal) => {
      return await fetch(`${this.baseUrl}/me`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.accessToken}` },
        signal,
      });
    });
  }
}
