import fetch from 'node-fetch';

import { API_VERSIONS, API_BASE_URLS, DEFAULT_TIMEOUTS } from '@config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';
import { validateNonEmptyString } from '../../utils/validation';
import { withRetry } from '../../utils/retry';
import { AbortController } from 'abort-controller';

/**
 * LinkedIn Publishing Adapter
 * Uses LinkedIn UGC (User Generated Content) API v2
 *
 * Required: LINKEDIN_ACCESS_TOKEN with w_member_social or w_organization_social scope
 * API Docs: https://docs.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/ugc-post-api
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

export interface LinkedInPost {
  text: string;
  visibility: 'PUBLIC' | 'CONNECTIONS' | undefined;
  media: Array<{
    type: 'IMAGE' | 'VIDEO' | 'ARTICLE';
    url: string | undefined;
    title: string | undefined;
    description: string | undefined;
    thumbnailUrl: string | undefined;
  }> | undefined;
}

export interface LinkedInPostResponse {
  id: string;
  activityUrn: string | undefined;
  status: 'created' | 'failed';
  permalink: string | undefined;
}

/**
 * Raw LinkedIn profile response from API
 */
export interface LinkedInProfileResponse {
  id: string;
  firstName: { localized: { en_US: string | undefined } | undefined } | undefined;
  lastName: { localized: { en_US: string | undefined } | undefined } | undefined;
  vanityName: string | undefined;
}

/**
 * Validated LinkedIn profile
 */
export interface ValidatedLinkedInProfile {
  id: string;
  firstName: string | undefined;
  lastName: string | undefined;
  vanityName: string | undefined;
}

/**
 * Media registration response from LinkedIn API
 */
export interface MediaRegistrationResponse {
  value: {
    uploadUrl: string | undefined;
    asset: string | undefined;
  } | undefined;
}

export interface LinkedInHealthStatus {
  healthy: boolean;
  latency: number;
  error: string | undefined;
}

/**
 * Validates and transforms raw LinkedIn profile response
 */
function validateLinkedInProfile(data: unknown): ValidatedLinkedInProfile {
  if (!data || typeof data !== 'object') {
    throw new ApiError('Invalid response format from LinkedIn API', 500);
  }

  const profile = data as Record<string, unknown>;

  if (!profile['id'] || typeof profile['id'] !== 'string') {
    throw new ApiError('Invalid response format: missing profile ID', 500);
  }

  // Safely extract nested localized values
  let firstName: string | undefined;
  let lastName: string | undefined;

  const firstNameObj = profile['firstName'];
  if (firstNameObj && typeof firstNameObj === 'object') {
    const firstNameRecord = firstNameObj as Record<string, unknown>;
    const localized = firstNameRecord['localized'];
    if (localized && typeof localized === 'object') {
      const localizedRecord = localized as Record<string, unknown>;
      const enUs = localizedRecord['en_US'];
      if (typeof enUs === 'string') {
        firstName = enUs;
      }
    }
  }

  const lastNameObj = profile['lastName'];
  if (lastNameObj && typeof lastNameObj === 'object') {
    const lastNameRecord = lastNameObj as Record<string, unknown>;
    const localized = lastNameRecord['localized'];
    if (localized && typeof localized === 'object') {
      const localizedRecord = localized as Record<string, unknown>;
      const enUs = localizedRecord['en_US'];
      if (typeof enUs === 'string') {
        lastName = enUs;
      }
    }
  }

  return {
    id: profile['id'] as string,
    firstName,
    lastName,
    vanityName: typeof profile['vanityName'] === 'string' ? profile['vanityName'] : undefined,
  };
}

/**
 * Validates media registration response
 */
// P1-FIX: Actually validate structure instead of blind type assertion
function validateMediaRegistrationResponse(data: unknown): MediaRegistrationResponse {
  if (!data || typeof data !== 'object') {
    throw new ApiError('Invalid media registration response', 500);
  }
  const record = data as Record<string, unknown>;
  const value = record['value'];
  if (value && typeof value === 'object') {
    const valueRecord = value as Record<string, unknown>;
    return {
      value: {
        uploadUrl: typeof valueRecord['uploadUrl'] === 'string' ? valueRecord['uploadUrl'] : undefined,
        asset: typeof valueRecord['asset'] === 'string' ? valueRecord['asset'] : undefined,
      },
    };
  }
  return { value: undefined };
}

export class LinkedInAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs = DEFAULT_TIMEOUTS.long;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(private readonly accessToken: string) {
    validateNonEmptyString(accessToken, 'accessToken');

    this.baseUrl = `${API_BASE_URLS.linkedin}/${API_VERSIONS.linkedin}`;
    this.logger = new StructuredLogger('LinkedInAdapter');
    this.metrics = new MetricsCollector('LinkedInAdapter');
  }

  /**
   * Get current user profile
   */
  async getProfile(): Promise<ValidatedLinkedInProfile> {
    const context = createRequestContext('LinkedInAdapter', 'getProfile');

    // P1-FIX: Move AbortController + json() INSIDE withRetry callback
    try {
      const validatedProfile = await withRetry(async () => {
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
              signal: controller.signal as AbortSignal,
            }
          );

          if (!response.ok) {
            if (response.status === 429) {
              const retryAfter = response.headers.get('retry-after') || undefined;
              throw new ApiError(`LinkedIn rate limited: ${response.status}`, response.status, retryAfter);
            }

            throw new Error(`LinkedIn API error: ${response.status} ${response.statusText}`);
          }

          const rawData = await response.json() as unknown;
          return validateLinkedInProfile(rawData);
        } finally {
          clearTimeout(timeoutId);
        }
      }, { maxRetries: 3 });

      this.metrics.recordSuccess('getProfile');

      return validatedProfile;
    } catch (error) {
      this.metrics.recordError('getProfile', error instanceof Error ? error.name : 'Unknown');
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to get LinkedIn profile', context, err);
      throw error;
    }
  }

  /**
   * Create a post on LinkedIn (personal profile)
   */
  async createPost(post: LinkedInPost): Promise<LinkedInPostResponse> {
    const profile = await this.getProfile();
    const authorUrn = `urn:li:person:${profile.id}`;
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

    this.logger.info('Creating LinkedIn post', context, { authorUrn: authorUrn.split(':').pop() });

    const startTime = Date.now();

    const visibility = post.visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC';

    // Build the request body
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

    // P1-FIX: Handle all media types in a single pass to avoid overwrites
    if (post.media && post.media.length > 0) {
      const articleMedia = post.media.filter(m => m.type === 'ARTICLE');
      const uploadableMedia = post.media.filter(m => m.type !== 'ARTICLE');

      const specificContent = requestBody['specificContent'] as Record<string, Record<string, unknown>>;
      const shareContent = specificContent['com.linkedin.ugc.ShareContent'];

      if (articleMedia.length > 0 && shareContent) {
        // Articles are handled inline, not via registerMedia
        const article = articleMedia[0];
        shareContent['shareMediaCategory'] = 'ARTICLE';
        shareContent['media'] = [{
          status: 'READY',
          originalUrl: article?.["url"],
          title: { text: article?.["title"] || '' },
          description: { text: article?.["description"] || '' },
          thumbnails: article?.["thumbnailUrl"] ? [{ url: article.thumbnailUrl }] : undefined,
        }];
      } else if (uploadableMedia.length > 0 && shareContent) {
        const mediaAssets = await Promise.all(
          uploadableMedia.map(m => this.registerMedia(authorUrn, m))
        );
        const firstMedia = uploadableMedia[0];
        shareContent['shareMediaCategory'] = firstMedia?.type === 'VIDEO' ? 'VIDEO' : 'IMAGE';
        shareContent['media'] = mediaAssets;
      }
    }

    // P1-FIX: AbortController inside retry + only retry transport errors for non-idempotent POST
    try {
      const { postId, activityUrn } = await withRetry(async () => {
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
            signal: controller.signal as AbortSignal,
          });

          if (!response.ok) {
            if (response.status === 429) {
              const retryAfter = response.headers.get('retry-after') || undefined;
              throw new ApiError(`LinkedIn rate limited: ${response.status}`, response.status, retryAfter);
            }

            // P1-FIX: Mark HTTP errors as non-retryable for non-idempotent POST
            const err = new Error(`LinkedIn UGC post failed: ${response.status} ${response.statusText}`);
            (err as Error & { noRetry: boolean }).noRetry = true;
            throw err;
          }

          return {
            postId: response.headers.get('x-restli-id') || response.headers.get('X-RestLi-Id') || '',
            activityUrn: response.headers.get('x-linkedin-id') || response.headers.get('X-LinkedIn-Id') || '',
          };
        } finally {
          clearTimeout(timeoutId);
        }
      }, { maxRetries: 3, shouldRetry: (err) => !(err as Error & { noRetry?: boolean }).noRetry });

      const permalink = activityUrn
        ? `https://www.linkedin.com/feed/update/${activityUrn}/`
        : undefined;

      const latency = Date.now() - startTime;
      this.metrics.recordLatency('createUgcPost', latency, true);
      this.metrics.recordSuccess('createUgcPost');
      this.logger.info('Successfully created LinkedIn post', context, { postId });

      const result: LinkedInPostResponse = {
        id: postId,
        activityUrn: activityUrn || undefined,
        permalink: permalink || undefined,
        status: 'created',
      };
      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('createUgcPost', latency, false);
      this.metrics.recordError('createUgcPost', error instanceof Error ? error.name : 'Unknown');
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to create LinkedIn post', context, err);
      throw error;
    }
  }

  /**
   * Register media asset for upload
   */
  private async registerMedia(
    authorUrn: string,
    media: NonNullable<LinkedInPost['media']>[number]
  ): Promise<{ status: string; media: string | undefined } | undefined> {
    if (media.type === 'ARTICLE') {
      return undefined; // Articles are handled differently
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await withRetry(async () => {
        const response = await fetch(`${this.baseUrl}/assets?action=registerUpload`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
          },
          body: JSON.stringify({
            registerUploadRequest: {
              owner: authorUrn,
              recipes: [
                media.type === 'VIDEO'
                  ? 'urn:li:digitalmediaRecipe:feedshare-video'
                  : 'urn:li:digitalmediaRecipe:feedshare-image',
              ],
              serviceRelationships: [
                {
                  identifier: 'urn:li:userGeneratedContent',
                  relationshipType: 'OWNER',
                },
              ],
            },
          }),
          signal: controller.signal as AbortSignal,
        });

        if (!response.ok) {
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after') || undefined;
            throw new ApiError(`LinkedIn rate limited: ${response.status}`, response.status, retryAfter);
          }

          throw new Error(`Failed to register media: ${response.status}`);
        }

        return response;
      }, { maxRetries: 3 });

      const rawData = await res.json() as unknown;

      // Use runtime validation instead of type assertion
      const data = validateMediaRegistrationResponse(rawData);

      // Return media reference for the post
      const result: { status: string; media: string | undefined } = {
        status: 'READY',
        media: data.value?.asset,
      };
      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async healthCheck(): Promise<LinkedInHealthStatus> {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.short);

    try {
      // Use the profile endpoint as health check
      const res = await fetch(
        `${this.baseUrl}/me?projection=(id)`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'X-Restli-Protocol-Version': '2.0.0',
          },
          signal: controller.signal as AbortSignal,
        }
      );

      const latency = Date.now() - start;
      // SECURITY FIX: Only 200 is healthy - 401/403 indicate auth errors
      const healthy = res.ok;

      const result: LinkedInHealthStatus = {
        healthy,
        latency,
        error: healthy ? undefined : `LinkedIn API returned status ${res.status}`,
      };
      return result;
    } catch (error) {
      const result: LinkedInHealthStatus = {
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
