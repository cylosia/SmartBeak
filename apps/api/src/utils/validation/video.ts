/**
 * Video platform validations
 * Vimeo, SoundCloud
 */

// ============================================================================
// Vimeo Type Guards
// ============================================================================

export interface VimeoVideoMetadata {
  name?: string;
  description?: string;
  privacy?: {
    view?: 'anybody' | 'nobody' | 'password' | 'users' | 'disable';
    embed?: 'public' | 'private';
    download?: boolean;
    add?: boolean;
    comments?: 'anybody' | 'nobody';
  };
  content_rating?: string[];
}

export interface VimeoVideoResponse {
  uri: string;
  name?: string;
  description?: string;
  link?: string;
  player_embed_url?: string;
  status?: 'available' | 'unavailable' | 'uploading' | 'transcoding' | 'quarantined' | 'uploading_error' | 'transcoding_error' | 'transcode_starting';
}

/**
 * Type guard for Vimeo video response
 */
export function isVimeoVideoResponse(data: unknown): data is VimeoVideoResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['uri'] === 'string';
}

// ============================================================================
// SoundCloud Type Guards
// ============================================================================

export interface SoundCloudTrackResponse {
  id: number;
  uri: string;
  title: string;
  permalink_url?: string;
  artwork_url?: string;
  stream_url?: string;
  status?: 'processing' | 'failed' | 'finished';
}

/**
 * Type guard for SoundCloud track response
 */
export function isSoundCloudTrackResponse(data: unknown): data is SoundCloudTrackResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj['id'] === 'number' && typeof obj['uri'] === 'string';
}
