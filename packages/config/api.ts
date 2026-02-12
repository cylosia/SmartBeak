/**
 * API Configuration
 * 
 * Configuration for external APIs and service endpoints.
 */

import { parseIntEnv } from './env';

/** Named constants for API configuration */
const API_CONSTANTS = {
  DEFAULT_TIMEOUT_MS: 30000,
  DEFAULT_RATE_LIMIT_PER_MINUTE: 100,
  DEFAULT_MAX_REQUEST_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  DEFAULT_PORT: 3001,
} as const;

export const apiConfig = {
  /** Timeout for API requests in milliseconds */
  timeoutMs: parseIntEnv('API_TIMEOUT_MS', API_CONSTANTS.DEFAULT_TIMEOUT_MS),

  /** Rate limit per minute */
  rateLimitPerMinute: parseIntEnv('API_RATE_LIMIT_PER_MINUTE', API_CONSTANTS.DEFAULT_RATE_LIMIT_PER_MINUTE),

  /** Maximum request size in bytes */
  maxRequestSize: parseIntEnv('API_MAX_REQUEST_SIZE', API_CONSTANTS.DEFAULT_MAX_REQUEST_SIZE_BYTES),

  /** Server port */
  port: parseIntEnv('PORT', API_CONSTANTS.DEFAULT_PORT),

  /** API versions for external services */
  versions: {
    facebook: 'v19.0',
    instagram: 'v19.0',
    linkedin: 'v2',
    pinterest: 'v5',
    youtube: 'v3',
    tiktok: 'v2',
    vercel: 'v13',
    aweber: '1.0',
    mailchimp: '3.0',
    constantContact: 'v3',
  } as const,

  /** Base URLs for external APIs */
  baseUrls: {
    facebook: 'https://graph.facebook.com',
    instagram: 'https://graph.facebook.com',
    linkedin: 'https://api.linkedin.com',
    pinterest: 'https://api.pinterest.com',
    youtube: 'https://www.googleapis.com/youtube',
    tiktok: 'https://open.tiktokapis.com',
    vercel: 'https://api.vercel.com',
    aweber: 'https://api.aweber.com',
    mailchimp: (server: string) => `https://${server}.api.mailchimp.com`,
    constantContact: 'https://api.cc.email',
    openai: 'https://api.openai.com/v1',
    stability: 'https://api.stability.ai/v2beta',
    vimeo: 'https://api.vimeo.com',
    soundcloud: 'https://api.soundcloud.com',
    serpapi: 'https://serpapi.com',
    ahrefs: 'https://api.ahrefs.com/v3',
    /** P1-3 FIX (audit 2): YouTube Analytics is a separate API from YouTube Data */
    youtubeAnalytics: 'https://youtubeanalytics.googleapis.com',
  } as const,
} as const;

/**
 * Build API URL with version
 */
export function buildApiUrl(
  baseUrl: string,
  version: string,
  path: string,
  queryParams?: Record<string, string | number | boolean | undefined>
): string {
  const cleanPath = path.replace(/^\/+/, '');
  let url = `${baseUrl}/${version}/${cleanPath}`;

  if (queryParams && Object.keys(queryParams).length > 0) {
    const searchParams = new URLSearchParams();
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    url += `?${searchParams.toString()}`;
  }
  return url;
}

/**
 * Get Mailchimp server URL
 */
export function getMailchimpBaseUrl(server: string): string {
  return `https://${server}.api.mailchimp.com/${apiConfig.versions.mailchimp}`;
}

/**
 * Get Facebook/Instagram Graph API URL
 */
export function getFacebookGraphUrl(version = apiConfig.versions.facebook): string {
  return `${apiConfig.baseUrls.facebook}/${version}`;
}

/**
 * API versions for external services (flat export)
 */
export const API_VERSIONS = apiConfig.versions;

/**
 * Base URLs for external APIs (flat export)
 */
export const API_BASE_URLS = apiConfig.baseUrls;
