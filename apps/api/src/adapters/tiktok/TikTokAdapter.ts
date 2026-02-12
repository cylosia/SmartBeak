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

export interface TikTokVideo {
  title: string;
  description: string | undefined;
  videoFile: Buffer | string;
  privacyLevel: 'PUBLIC' | 'FOLLOWERS_OF_CREATOR' | 'MENTIONED_ONLY' | undefined;
  disableDuet: boolean | undefined;
  disableStitch: boolean | undefined;
  disableComment: boolean | undefined;
  brandOrganicType: 'AUTHORED_BY_BRAND' | 'AUTHORED_BY_CREATOR' | undefined;
  isAigc: boolean | undefined;
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

      // P1-4 FIX: Validate all returned fields with type checks and safe defaults
      return {
        creatorId: user.open_id,
        creatorName: user.display_name,
        avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : '',
        followerCount: typeof user.follower_count === 'number' ? user.follower_count : 0,
        followingCount: typeof user.following_count === 'number' ? user.following_count : 0,
        likesCount: typeof user.likes_count === 'number' ? user.likes_count : 0,
        videoCount: typeof user.video_count === 'number' ? user.video_count : 0,
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

      const latency = Date.now() - startTime;
      this.metrics.recordLatency('publishVideoDirect', latency, true);
      this.metrics.recordSuccess('publishVideoDirect');
      this.logger.info('Successfully published TikTok video', context, {
        publishId: data.data?.publish_id
      });

      // P1-1 FIX: Throw error if publish_id is missing instead of silently returning empty string
      if (!data.data?.publish_id) {
        throw new ApiError('TikTok API returned no publish_id', 502);
      }

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

      // P1-3 FIX: Add runtime validation (same pattern as getCreatorInfo)
      const rawData = await res.json() as unknown;
      if (!rawData || typeof rawData !== 'object') {
        throw new ApiError('Invalid response format from TikTok upload init', 500);
      }
      const data = rawData as {
        data: { publish_id: string; upload_url: string } | undefined;
        error: { code: string; message: string } | undefined;
      };

      if (data.error) {
        throw new Error(`TikTok error: ${data.error.code} - ${data.error["message"]}`);
      }

      // P1-1 FIX: Throw error if publish_id or upload_url is missing
      if (!data.data?.publish_id || !data.data?.upload_url) {
        throw new ApiError('TikTok API returned incomplete upload session data', 502);
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
    // P2-12 FIX: Validate upload URL points to expected TikTok domain (SSRF prevention)
    const parsedUrl = new URL(uploadUrl);
    const allowedHosts = ['open.tiktokapis.com', 'upload.tiktokapis.com'];
    if (!allowedHosts.some(host => parsedUrl.hostname === host || parsedUrl.hostname.endsWith('.' + host))) {
      throw new ApiError(`Untrusted upload URL host: ${parsedUrl.hostname}`, 400);
    }

    // P2-13 FIX: Validate buffer size before upload (max 4GB per TikTok API docs)
    const MAX_VIDEO_SIZE = 4 * 1024 * 1024 * 1024; // 4GB
    const videoSize = Buffer.byteLength(videoBuffer);
    if (videoSize > MAX_VIDEO_SIZE) {
      throw new ApiError(`Video size ${videoSize} bytes exceeds maximum ${MAX_VIDEO_SIZE} bytes`, 400);
    }

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
  // P1-2 FIX: Removed dead AbortController + setTimeout that was never connected
  // to any operation. getCreatorInfo() creates its own internal controller.
  async healthCheck(): Promise<TikTokHealthStatus> {
    const start = Date.now();

    try {
      await this.getCreatorInfo();

      return {
        healthy: true,
        latency: Date.now() - start,
        error: undefined,
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - start,
        error: error instanceof Error ? error["message"] : 'Unknown error',
      };
    }
  }
}
