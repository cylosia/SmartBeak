
import { CdnTransformError } from '../errors';
export type CdnTransform = {
  width: number;
  height: number;
  fit: 'cover' | 'contain';
  format: 'jpg' | 'png' | 'webp';
};

export const CDN_PRESETS = {
  web_hero: { width: 1200, height: 630, fit: 'cover', format: 'webp' },
  pinterest: { width: 1000, height: 1500, fit: 'cover', format: 'jpg' },
  email: { width: 600, height: 0, fit: 'contain', format: 'jpg' },
  youtube_thumb: { width: 1280, height: 720, fit: 'cover', format: 'jpg' }
};

/**
* Validates a URL string to prevent injection attacks
*/
function isValidUrl(url: string): boolean {
  try {
  const parsed = new URL(url);
  // Only allow http and https protocols
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
  return false;
  }
}

export function buildCdnUrl(base: string, preset: keyof typeof CDN_PRESETS) {

  if (!base || typeof base !== 'string') {
  throw new CdnTransformError('Base URL is required');
  }

  if (!isValidUrl(base)) {
  throw new CdnTransformError(`Invalid base URL: ${base}`);
  }

  const t = CDN_PRESETS[preset];
  if (!t) {
  throw new CdnTransformError(`Invalid preset: ${preset}`);
  }

  return `${base}?w=${t.width}&h=${t.height}&fit=${t.fit}&fm=${t.format}`;
}
