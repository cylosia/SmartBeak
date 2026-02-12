import fetch from 'node-fetch';

import { API_VERSIONS, API_BASE_URLS, DEFAULT_TIMEOUTS } from '@config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '../../utils/request';
import { validateNonEmptyString } from '../../utils/validation';
import { withRetry } from '../../utils/retry';
import { AbortController } from 'abort-controller';

/**
 * TikTok Publishing Adapter
 * Uses TikTok API for Business (Content Publishing API)
 *
 * Required: TIKTOK_ACCESS_TOKEN with video.publish permission
 * API Docs: https://developers.tiktok.com/doc/content-posting-api-get-started
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

// P3-8 FIX: Use optional properties (?) instead of T | undefined
// to avoid requiring callers to explicitly pass undefined for unused fields
export interface TikTokVideo {
  title: string;
  description?: string;
  videoFile: Buffer | string;
  privacyLevel?: 'PUBLIC' | 'FOLLOWERS_OF_CREATOR' | 'MENTIONED_ONLY';
  disableDuet?: boolean;
  disableStitch?: boolean;
  disableComment?: boolean;
  brandOrganicType?: 'AUTHORED_BY_BRAND' | 'AUTHORED_BY_CREATOR';
  isAigc?: boolean;
}

export interface TikTokUploadSession {
  uploadUrl: string;
  publishId: string;
}

export interface TikTokPostResponse {
  publishId: string;
  shareId: string | undefined;
  createTime: string | undefined;
  status: 'processing' | 'published' | 'failed';
}

export interface TikTokCreatorInfoResponse {
  data: {
    user: {
      open_id: string;
      union_id: string;
      display_name: string;
      avatar_url: string;
      follower_count: number;
      following_count: number;
      likes_count: number;
      video_count: number;
    } | undefined;
  } | undefined;
  error: {
    code: string;
    message: string;
  } | undefined;
}

export interface TikTokHealthStatus {
  healthy: boolean;
  latency: number;
  error: string | undefined;
}

export class TikTokAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs = DEFAULT_TIMEOUTS.extended;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(
    private readonly accessToken: string,
    private readonly creatorId?: string
  ) {
    // Input validation
    validateNonEmptyString(accessToken, 'accessToken');

    // Use configuration constant
    this.baseUrl = `${API_BASE_URLS.tiktok}/${API_VERSIONS.tiktok}`;
    this.logger = new StructuredLogger('TikTokAdapter');
    this.metrics = new MetricsCollector('TikTokAdapter');
  }

  /**
   * Get creator info
   */
  async getCreatorInfo(): Promise<{
    creatorId: string;
    creatorName: string;
    avatarUrl: string;
    followerCount: number;
    followingCount: number;
    likesCount: number;
    videoCount: number;
  }> {
    const context = createRequestContext('TikTokAdapter', 'getCreatorInfo');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await withRetry(async () => {
        const response = await fetch(`${this.baseUrl}/user/info/`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fields: ['open_id', 'union_id', 'avatar_url', 'display_name', 'follower_count', 'following_count', 'likes_count', 'video_count'],
          }),
          signal: controller.signal as AbortSignal,
        });

        // Check res.ok
        if (!response.ok) {
          // Check for rate limiting
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after') || undefined;
            throw new ApiError(`TikTok rate limited: ${response.status}`, response.status, retryAfter);
          }

          throw new Error(`TikTok API error: ${response.status} ${response.statusText}`);
        }

        return response;
      }, { maxRetries: 3 });

      const rawData = await res.json() as unknown;
      // Runtime response validation
      if (!rawData || typeof rawData !== 'object') {
        throw new ApiError('Invalid response format from TikTok API', 500);
      }
      const data = rawData as TikTokCreatorInfoResponse;

      if (data.error) {
        throw new Error(`TikTok error: ${data.error.code} - ${data.error["message"]}`);
      }

      // Validate nested structure
      if (!data.data || typeof data.data !== 'object') {
        throw new ApiError('Invalid response data structure: missing data field', 500);
      }

      const user = data.data.user;
      if (!user || typeof user !== 'object') {
        throw new Error('Creator info not found');
      }

      // Validate required user fields
      if (typeof user.open_id !== 'string' || typeof user.display_name !== 'string') {
        throw new ApiError('Invalid user data: missing required fields', 500);
      }

      this.metrics.recordSuccess('getCreatorInfo');

      return {
        creatorId: user.open_id,
        creatorName: user.display_name,
        avatarUrl: user.avatar_url,
        followerCount: user.follower_count,
        followingCount: user.following_count,
        likesCount: user.likes_count,
        videoCount: user.video_count,
      };
    } catch (error) {
      this.metrics.recordError('getCreatorInfo', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to get TikTok creator info', context, error as Error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Publish video directly via URL (for videos < 60s)
   */
  async publishVideoDirect(video: TikTokVideo): Promise<TikTokPostResponse> {
    const context = createRequestContext('TikTokAdapter', 'publishVideoDirect');

    // Input validation
    validateNonEmptyString(video.title, 'title');
    if (typeof video.videoFile !== 'string') {
      throw new Error('publishVideoDirect requires a URL string for videoFile');
    }
    validateNonEmptyString(video.videoFile, 'videoFile');

    this.logger.info('Publishing video to TikTok', context, { title: video.title });

    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await withRetry(async () => {
        const response = await fetch(`${this.baseUrl}/post/publish/video/init/`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            source_info: {
              source: 'PULL_FROM_URL',
              url: video.videoFile,
            },
            title: video.title,
            description: video.description,
            privacy_level: video.privacyLevel || 'PUBLIC',
            disable_duet: video.disableDuet || false,
            disable_stitch: video.disableStitch || false,
            disable_comment: video.disableComment || false,
            brand_organic_type: video.brandOrganicType,
            is_aigc: video.isAigc || false,
          }),
          signal: controller.signal as AbortSignal,
        });

        // Check res.ok
        if (!response.ok) {
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after') || undefined;
            throw new ApiError(`TikTok rate limited: ${response.status}`, response.status, retryAfter);
          }

          throw new Error(`TikTok publish error: ${response.status} ${response.statusText}`);
        }

        return response;
      }, { maxRetries: 3 });

      const rawData = await res.json() as unknown;
      // Runtime response validation
      if (!rawData || typeof rawData !== 'object') {
        throw new ApiError('Invalid response format from TikTok API', 500);
      }
      const data = rawData as {
        data: { publish_id: string } | undefined;
        error: { code: string; message: string } | undefined;
      };

      if (data.error) {
        throw new Error(`TikTok error: ${data.error.code} - ${data.error["message"]}`);
      }

      // P1-4 FIX: Validate required fields instead of using empty string fallbacks
      if (!data.data?.publish_id) {
        throw new ApiError('Missing publish_id in TikTok API response', 500);
      }

      const latency = Date.now() - startTime;
      this.metrics.recordLatency('publishVideoDirect', latency, true);
      this.metrics.recordSuccess('publishVideoDirect');
      this.logger.info('Successfully published TikTok video', context, {
        publishId: data.data.publish_id
      });

      const result: TikTokPostResponse = {
        publishId: data.data.publish_id,
        shareId: undefined,
        createTime: undefined,
        status: 'processing',
      };
      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('publishVideoDirect', latency, false);
      this.metrics.recordError('publishVideoDirect', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to publish TikTok video', context, error as Error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Full upload and publish flow
   */
  async publishVideo(video: TikTokVideo): Promise<TikTokPostResponse> {
    // If videoFile is a string (URL), use direct publishing
    if (typeof video.videoFile === 'string') {
      return this.publishVideoDirect(video);
    }

    // Otherwise, use file upload flow
    const session = await this.initializeUpload(video);
    await this.uploadVideo(session.uploadUrl, video.videoFile);

    const result: TikTokPostResponse = {
      publishId: session.publishId,
      shareId: undefined,
      createTime: undefined,
      status: 'processing',
    };
    return result;
  }

  /**
   * Initialize file upload session
   */
  private async initializeUpload(video: TikTokVideo): Promise<TikTokUploadSession> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await withRetry(async () => {
        const response = await fetch(`${this.baseUrl}/post/publish/video/init/`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            source_info: {
              source: 'FILE_UPLOAD',
              // Use Buffer.byteLength for accurate size calculation
              video_size: Buffer.byteLength(video.videoFile as Buffer),
              chunk_size: 0,
              total_chunk_count: 1,
            },
            title: video.title,
            privacy_level: video.privacyLevel || 'PUBLIC',
            disable_duet: video.disableDuet || false,
            disable_stitch: video.disableStitch || false,
            disable_comment: video.disableComment || false,
          }),
          signal: controller.signal as AbortSignal,
        });

        if (!response.ok) {
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after') || undefined;
            throw new ApiError(`TikTok rate limited: ${response.status}`, response.status, retryAfter);
          }

          throw new Error(`TikTok upload init error: ${response.status}`);
        }

        return response;
      }, { maxRetries: 3 });

      // P1-6 FIX: Add runtime response validation (matching getCreatorInfo pattern)
      const rawData = await res.json() as unknown;
      if (!rawData || typeof rawData !== 'object') {
        throw new ApiError('Invalid response format from TikTok upload init API', 500);
      }
      const data = rawData as {
        data: { publish_id: string; upload_url: string } | undefined;
        error: { code: string; message: string } | undefined;
      };

      if (data.error) {
        throw new Error(`TikTok error: ${data.error.code} - ${data.error["message"]}`);
      }

      // P1-4 FIX: Validate required response fields
      if (!data.data?.publish_id || !data.data?.upload_url) {
        throw new ApiError('Missing publish_id or upload_url in TikTok upload init response', 500);
      }

      return {
        publishId: data.data.publish_id,
        uploadUrl: data.data.upload_url,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Upload video file
   */
  private async uploadVideo(uploadUrl: string, videoBuffer: Buffer): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      await withRetry(async () => {
        const response = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': Buffer.byteLength(videoBuffer).toString(),
          },
          body: videoBuffer,
          signal: controller.signal as AbortSignal,
        });

        if (!response.ok) {
          throw new Error(`TikTok upload error: ${response.status}`);
        }

        return response;
      }, { maxRetries: 3 });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Health check for TikTok API
   */
  async healthCheck(): Promise<TikTokHealthStatus> {
    const start = Date.now();
    // P1-5 FIX: Use a dedicated lightweight fetch with the short timeout
    // instead of calling getCreatorInfo() which uses its own extended timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.short);

    try {
      const response = await fetch(`${this.baseUrl}/user/info/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: ['open_id'],
        }),
        signal: controller.signal as AbortSignal,
      });

      // SECURITY FIX: Only healthy if API responds with 200
      const result: TikTokHealthStatus = {
        healthy: response.ok,
        latency: Date.now() - start,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
      return result;
    } catch (error) {
      // SECURITY FIX: Auth errors (401/403) are NOT healthy - credentials are invalid
      const result: TikTokHealthStatus = {
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
