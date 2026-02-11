/**
 * API Utils Configuration
 * 
 * Centralized configuration for API utilities.
 * This file provides configuration constants and types for the API layer.
 */

// ============================================================================
// Service Names
// ============================================================================

export type ServiceName = 
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'pinterest'
  | 'youtube'
  | 'tiktok'
  | 'twitter'
  | 'wordpress'
  | 'mailchimp'
  | 'aweber'
  | 'constantcontact'
  | 'vercel'
  | 'gsc'
  | 'ga'
  | 'gbp'
  | 'openai'
  | 'stability'
  | 'vimeo'
  | 'soundcloud';

// ============================================================================
// API Versions
// ============================================================================

export const API_VERSIONS = {
  facebook: 'v19.0',
  instagram: 'v19.0',
  linkedin: 'v2',
  pinterest: 'v5',
  youtube: 'v3',
  tiktok: 'v2',
  twitter: 'v2',
  wordpress: 'v1',
  mailchimp: '3.0',
  aweber: '1.0',
  constantcontact: 'v3',
  vercel: 'v13',
} as const;

// ============================================================================
// API Base URLs
// ============================================================================

export const API_BASE_URLS = {
  facebook: 'https://graph.facebook.com',
  instagram: 'https://graph.facebook.com',
  linkedin: 'https://api.linkedin.com',
  pinterest: 'https://api.pinterest.com',
  youtube: 'https://www.googleapis.com/youtube',
  tiktok: 'https://open.tiktokapis.com',
  twitter: 'https://api.twitter.com',
  wordpress: 'https://public-api.wordpress.com',
  mailchimp: (server: string) => `https://${server}.api.mailchimp.com`,
  aweber: 'https://api.aweber.com',
  constantcontact: 'https://api.cc.email',
  vercel: 'https://api.vercel.com',
  gsc: 'https://www.googleapis.com/webmasters/v3',
  ga: 'https://analyticsdata.googleapis.com',
  gbp: 'https://mybusiness.googleapis.com',
  openai: 'https://api.openai.com/v1',
  stability: 'https://api.stability.ai/v2beta',
  vimeo: 'https://api.vimeo.com',
  soundcloud: 'https://api.soundcloud.com',
} as const;

export type ApiBaseUrls = typeof API_BASE_URLS;

// ============================================================================
// Timeout Configuration
// ============================================================================

export type TimeoutDuration = 'short' | 'medium' | 'long' | 'extended';

export const DEFAULT_TIMEOUTS = {
  short: 5000,      // 5 seconds - health checks
  medium: 15000,    // 15 seconds - normal operations
  long: 30000,      // 30 seconds - complex operations
  extended: 60000,  // 60 seconds - uploads/downloads
} as const;

// ============================================================================
// Retry Configuration
// ============================================================================

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  minDelayMs: number;
  retryableStatuses: number[];
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  minDelayMs: 100,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  backoffMultiplier: 2,
} as const;

// ============================================================================
// Circuit Breaker Configuration
// ============================================================================

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxAttempts: 3,
} as const;

// ============================================================================
// Rate Limiting Configuration
// ============================================================================

export interface RateLimitConfig {
  defaultRequestsPerSecond?: number | undefined;
  defaultRequestsPerMinute?: number | undefined;
  defaultRequestsPerHour?: number | undefined;
  burstAllowance?: number | undefined;
  tokensPerInterval?: number | undefined;
  intervalSeconds?: number | undefined;
  burstSize?: number | undefined;
  maxRetries?: number | undefined;
  retryDelayMs?: number | undefined;
  failureThreshold?: number | undefined;
  cooldownSeconds?: number | undefined;
}

export const RATE_LIMIT_CONFIG: RateLimitConfig = {
  defaultRequestsPerSecond: 10,
  defaultRequestsPerMinute: 100,
  defaultRequestsPerHour: 1000,
  burstAllowance: 5,
} as const;

// ============================================================================
// Query Parameters Type
// ============================================================================

export type QueryParams = Record<string, string | number | boolean | undefined>;

// ============================================================================
// URL Building Utilities
// ============================================================================

/**
 * Build API URL with version
 */
export function buildApiUrl(
  baseUrl: string,
  version: string,
  path: string,
  queryParams?: QueryParams
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
  return `https://${server}.api.mailchimp.com/${API_VERSIONS.mailchimp}`;
}

/**
 * Get Facebook/Instagram Graph API URL
 */
export function getFacebookGraphUrl(version = API_VERSIONS.facebook): string {
  return `${API_BASE_URLS.facebook}/${version}`;
}
