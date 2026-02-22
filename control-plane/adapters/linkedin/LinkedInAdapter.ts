import fetch from 'node-fetch';

import { apiConfig } from '@config';
import { validateNonEmptyString } from '@kernel/validation';
import { withRetry } from '@kernel/retry';
import type { PublishAdapter, PublishInput } from '@domain/publishing/application/ports/PublishAdapter';

import { BaseExternalAdapter, AdapterApiError } from '../base';


/**
 * LinkedIn Publishing Adapter
 * Uses LinkedIn UGC (User Generated Content) API v2
 *
 * Required: LINKEDIN_ACCESS_TOKEN with w_member_social or w_organization_social scope
 */

export interface LinkedInPost {
  text: string;
  visibility?: 'PUBLIC' | 'CONNECTIONS' | undefined;
  media?: Array<{
    type: 'IMAGE' | 'VIDEO' | 'ARTICLE';
    url?: string | undefined;
    title?: string | undefined;
    description?: string | undefined;
    thumbnailUrl?: string | undefined;
  }> | undefined;
}

export interface LinkedInPostResponse {
  id: string;
  activityUrn?: string | undefined;
  status: 'created' | 'failed';
  permalink?: string | undefined;
}

export class LinkedInAdapter extends BaseExternalAdapter implements PublishAdapter {
  private readonly baseUrl: string;

  constructor(private readonly accessToken: string) {
    super('LinkedInAdapter');
    validateNonEmptyString(accessToken, 'accessToken');
    this.baseUrl = `${apiConfig.baseUrls.linkedin}/${apiConfig.versions.linkedin}`;
  }

  /**
   * Get current user profile
   */
  async getProfile(): Promise<{
    id: string;
    firstName?: string | undefined;
    lastName?: string | undefined;
    vanityName?: string | undefined;
  }> {
    const data = await withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(
          `${this.baseUrl}/me?projection=(id,firstName,lastName,vanityName)`,
          {
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'X-Restli-Protocol-Version': '2.0.0',
              'Accept': 'application/json',
            },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          if (response.status === 429) {
            throw this.createRateLimitError('LinkedIn', response.status, response.headers);
          }
          throw new Error(`LinkedIn API error: ${response.status} ${response.statusText}`);
        }

        const rawData = await response.json();
        if (!rawData || typeof rawData !== 'object') {
          throw new AdapterApiError('Invalid response format from LinkedIn API', 500);
        }
        const parsed = rawData as { id?: unknown; firstName?: unknown; lastName?: unknown; vanityName?: unknown };
        if (typeof parsed['id'] !== 'string' || !parsed['id']) {
          throw new AdapterApiError('Invalid response format from LinkedIn API: missing or non-string id', 500);
        }
        if (parsed['firstName'] !== undefined && (typeof parsed['firstName'] !== 'object' || parsed['firstName'] === null)) {
          throw new AdapterApiError('Invalid response format from LinkedIn API: invalid firstName shape', 500);
        }
        if (parsed['lastName'] !== undefined && (typeof parsed['lastName'] !== 'object' || parsed['lastName'] === null)) {
          throw new AdapterApiError('Invalid response format from LinkedIn API: invalid lastName shape', 500);
        }
        return parsed as {
          id: string;
          firstName?: { localized?: { en_US?: string } };
          lastName?: { localized?: { en_US?: string } };
          vanityName?: string;
        };
      } finally {
        clearTimeout(timeoutId);
      }
    }, { maxRetries: 3 });

    return {
      id: data["id"],
      firstName: data.firstName?.localized?.en_US,
      lastName: data.lastName?.localized?.en_US,
      vanityName: data.vanityName,
    };
  }

  /**
   * Create a post on LinkedIn (personal profile)
   */
  async createPost(post: LinkedInPost): Promise<LinkedInPostResponse> {
    const profile = await this.getProfile();
    const authorUrn = `urn:li:person:${profile["id"]}`;
    return this.createUgcPost(authorUrn, post);
  }

  /**
   * Create a post on a LinkedIn Company Page
   */
  async createCompanyPost(organizationId: string, post: LinkedInPost): Promise<LinkedInPostResponse> {
    validateNonEmptyString(organizationId, 'organizationId');
    const authorUrn = `urn:li:organization:${organizationId}`;
    return this.createUgcPost(authorUrn, post);
  }

  /**
   * Create UGC Post (core method)
   */
  private async createUgcPost(authorUrn: string, post: LinkedInPost): Promise<LinkedInPostResponse> {
    validateNonEmptyString(post.text, 'post.text');

    return this.instrumented('createUgcPost', async (context) => {
      const visibility = post.visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC';

      const requestBody: Record<string, unknown> = {
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': visibility,
        },
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: post.text },
            shareMediaCategory: 'NONE',
          },
        },
      };

      const { postId } = await withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const response = await fetch(`${this.baseUrl}/ugcPosts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'Content-Type': 'application/json',
              'X-Restli-Protocol-Version': '2.0.0',
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });

          if (!response.ok) {
            if (response.status === 429) {
              throw this.createRateLimitError('LinkedIn', response.status, response.headers);
            }
            // Don't retry non-idempotent POST on HTTP errors
            const err = new Error(`LinkedIn UGC post failed: ${response.status} ${response.statusText}`);
            (err as Error & { noRetry: boolean }).noRetry = true;
            throw err;
          }

          const postIdHeader = response.headers.get('x-restli-id') || '';
          return { postId: postIdHeader };
        } finally {
          clearTimeout(timeoutId);
        }
      }, { maxRetries: 3, shouldRetry: (err) => !(err as Error & { noRetry?: boolean }).noRetry });

      this.logger.info('Successfully created LinkedIn post', context, { postId });

      return {
        id: postId,
        status: 'created',
      };
    });
  }

  /**
   * Publish content via the PublishAdapter interface.
   */
  async publish(input: PublishInput): Promise<void> {
    const text = input.targetConfig.options?.['text'];
    if (typeof text !== 'string' || !text) {
      throw new Error('LinkedIn publish requires targetConfig.options.text');
    }
    await this.createPost({ text });
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string | undefined }> {
    return this.healthProbe(async (signal) => {
      return await fetch(`${this.baseUrl}/me?projection=(id)`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        signal,
      });
    });
  }
}
