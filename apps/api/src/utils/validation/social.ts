/**
 * Social platform validations
 * Facebook, Instagram, LinkedIn, Pinterest, TikTok, YouTube
 */

// ============================================================================
// Facebook Type Guards
// ============================================================================

export interface FacebookPostResponse {
  id: string;
  post_id?: string;
}

export interface FacebookErrorResponse {
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

/**
 * Type guard for Facebook error response
 */
export function isFacebookErrorResponse(data: unknown): data is FacebookErrorResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;

  if (!obj['error'] || typeof obj['error'] !== 'object') return false;
  const error = obj['error'] as Record<string, unknown>;

  return typeof error['message'] === 'string' &&
      typeof error['type'] === 'string' &&
      typeof error['code'] === 'number';
}

/**
 * Type guard for Facebook post response
 */
export function isFacebookPostResponse(data: unknown): data is FacebookPostResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['id'] === 'string';
}

// ============================================================================
// Instagram Type Guards
// ============================================================================

export interface InstagramPostResponse {
  id: string;
  permalink?: string;
  status: 'published' | 'failed';
}

/**
 * Type guard for Instagram post response
 */
export function isInstagramPostResponse(data: unknown): data is InstagramPostResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['id'] === 'string';
}

// ============================================================================
// LinkedIn Type Guards
// ============================================================================

export interface LinkedInPostResponse {
  id: string;
  activityUrn?: string;
  status: 'created' | 'failed';
  permalink?: string;
}

/**
 * Type guard for LinkedIn post response
 */
export function isLinkedInPostResponse(data: unknown): data is LinkedInPostResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['id'] === 'string';
}

// ============================================================================
// Pinterest Type Guards
// ============================================================================

export interface PinterestPostResponse {
  id: string;
  link?: string;
  url?: string;
}

/**
 * Type guard for Pinterest post response
 */
export function isPinterestPostResponse(data: unknown): data is PinterestPostResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['id'] === 'string';
}

// ============================================================================
// TikTok Type Guards
// ============================================================================

export interface TikTokPostResponse {
  publishId: string;
  shareId?: string;
  createTime?: string;
  status: 'processing' | 'published' | 'failed';
}

/**
 * Type guard for TikTok post response
 */
export function isTikTokPostResponse(data: unknown): data is TikTokPostResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['publishId'] === 'string' || typeof obj['id'] === 'string';
}

// ============================================================================
// YouTube Type Guards
// ============================================================================

export interface YouTubeVideoSnippet {
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  defaultLanguage?: string;
}

export interface YouTubeVideoStatus {
  privacyStatus?: 'public' | 'unlisted' | 'private';
  publishAt?: string;
  selfDeclaredMadeForKids?: boolean;
}

export interface YouTubeVideoResponse {
  id: string;
  snippet?: YouTubeVideoSnippet;
  status?: YouTubeVideoStatus;
}

/**
 * Type guard for YouTube video response
 */
export function isYouTubeVideoResponse(data: unknown): data is YouTubeVideoResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['id'] === 'string';
}
