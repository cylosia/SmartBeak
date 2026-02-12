import fetch from 'node-fetch';

import { apiConfig, timeoutConfig } from '@config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';
import { validateNonEmptyString } from '@kernel/validation';
import { withRetry } from '@kernel/retry';

import { AbortController } from 'abort-controller';


/**
* LinkedIn Publishing Adapter
* Uses LinkedIn UGC (User Generated Content) API v2
*
*
* Required: LINKEDIN_ACCESS_TOKEN with w_member_social or w_organization_social scope
*/

/**
* API Error with status code and retry information
*/
class ApiError extends Error {
  constructor(
  message: string,
  public status: number,
  public retryAfter?: string
  ) {
  super(message);
  this.name = 'ApiError';
  }
}

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

export class LinkedInAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs = timeoutConfig.long;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(private readonly accessToken: string) {
  validateNonEmptyString(accessToken, 'accessToken');

  this.baseUrl = `${apiConfig.baseUrls.linkedin}/${apiConfig.versions.linkedin}`;
  this.logger = new StructuredLogger('LinkedInAdapter');
  this.metrics = new MetricsCollector('LinkedInAdapter');
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
  // P1-FIX: Move AbortController + res.json() INSIDE withRetry callback
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
    }
    );

    if (!response.ok) {
    if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || undefined;
    throw new ApiError(`LinkedIn rate limited: ${response.status}`, response.status, retryAfter);
    }

    throw new Error(`LinkedIn API error: ${response.status} ${response.statusText}`);
    }

    const rawData = await response.json();
    if (!rawData || typeof rawData !== 'object' || !(rawData as { id?: unknown })["id"]) {
    throw new ApiError('Invalid response format from LinkedIn API', 500);
    }
    return rawData as {
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
  const context = createRequestContext('LinkedInAdapter', 'createUgcPost');

  validateNonEmptyString(post.text, 'post.text');

  this.logger.info('Creating LinkedIn post', context);

  const startTime = Date.now();

  const visibility = post.visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC';

  const requestBody: Record<string, unknown> = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    visibility: {
    'com.linkedin.ugc.MemberNetworkVisibility': visibility,
    },
    specificContent: {
    'com.linkedin.ugc.ShareContent': {
    shareCommentary: {
    text: post.text,
    },
    shareMediaCategory: 'NONE',
    },
    },
  };

  // P1-FIX: Move AbortController INSIDE withRetry + only retry on transport errors (not HTTP errors)
  try {
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
    const retryAfter = response.headers.get('retry-after') || undefined;
    throw new ApiError(`LinkedIn rate limited: ${response.status}`, response.status, retryAfter);
    }

    // P1-FIX: Don't retry non-idempotent POST on HTTP errors — only throw, don't retry
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

    const latency = Date.now() - startTime;
    this.metrics.recordLatency('createUgcPost', latency, true);
    this.metrics.recordSuccess('createUgcPost');
    this.logger.info('Successfully created LinkedIn post', context, { postId });

    return {
    id: postId,
    status: 'created',
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    this.metrics.recordLatency('createUgcPost', latency, false);
    this.metrics.recordError('createUgcPost', error instanceof Error ? error.name : 'Unknown');
    this.logger["error"]('Failed to create LinkedIn post', context, error as Error);
    throw error;
  }
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string | undefined }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutConfig.short);

  try {
    const res = await fetch(
    `${this.baseUrl}/me?projection=(id)`,
    {
    headers: {
    'Authorization': `Bearer ${this.accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
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
    error: healthy ? undefined : `LinkedIn API returned status ${res.status}`,
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
