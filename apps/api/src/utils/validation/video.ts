/**
 * Video platform validations
 * Vimeo, SoundCloud
 *
 * P2-5 FIX: Type guards now validate all required fields, not just minimal properties.
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

// P1-FIX: Enumerate all valid Vimeo status values so the type guard rejects
// unknown strings from rogue API responses instead of accepting any string.
// Accepting arbitrary strings corrupts downstream state machines that switch on status.
const VIMEO_VALID_STATUSES: ReadonlySet<string> = new Set([
  'available',
  'unavailable',
  'uploading',
  'transcoding',
  'quarantined',
  'uploading_error',
  'transcoding_error',
  'transcode_starting',
]);

/**
 * Type guard for Vimeo video response
 * P2-5 FIX: Validate all required fields and check optional field types
 * P1-FIX: Validate status against the closed union literal set
 */
export function isVimeoVideoResponse(data: unknown): data is VimeoVideoResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj['uri'] === 'string' &&
    (obj['name'] === undefined || typeof obj['name'] === 'string') &&
    (obj['description'] === undefined || typeof obj['description'] === 'string') &&
    (obj['link'] === undefined || typeof obj['link'] === 'string') &&
    (obj['player_embed_url'] === undefined || typeof obj['player_embed_url'] === 'string') &&
    (obj['status'] === undefined ||
      (typeof obj['status'] === 'string' && VIMEO_VALID_STATUSES.has(obj['status'])))
  );
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

// P1-FIX: Enumerate all valid SoundCloud status values.
const SOUNDCLOUD_VALID_STATUSES: ReadonlySet<string> = new Set([
  'processing',
  'failed',
  'finished',
]);

/**
 * Type guard for SoundCloud track response
 * P2-5 FIX: Validate all required fields (id, uri, title) instead of only id and uri
 * P1-FIX: Validate status against the closed union literal set
 */
export function isSoundCloudTrackResponse(data: unknown): data is SoundCloudTrackResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj['id'] === 'number' &&
    typeof obj['uri'] === 'string' &&
    typeof obj['title'] === 'string' &&
    (obj['permalink_url'] === undefined || typeof obj['permalink_url'] === 'string') &&
    (obj['artwork_url'] === undefined || typeof obj['artwork_url'] === 'string') &&
    (obj['stream_url'] === undefined || typeof obj['stream_url'] === 'string') &&
    (obj['status'] === undefined ||
      (typeof obj['status'] === 'string' && SOUNDCLOUD_VALID_STATUSES.has(obj['status'])))
  );
}
