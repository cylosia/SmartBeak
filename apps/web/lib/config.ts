/**
 * Web App Configuration
 * Environment-specific configuration for the web application
 */

/**
 * Security configuration
 */
export const securityConfig = {
  /** CSRF token expiry in milliseconds (1 hour) */
  csrfTokenExpiryMs: 3600000,
  /** Session timeout in milliseconds (24 hours) */
  sessionTimeoutMs: 24 * 60 * 60 * 1000,
  /** Maximum login attempts before lockout */
  maxLoginAttempts: 5,
  /** Lockout duration in milliseconds (30 minutes) */
  lockoutDurationMs: 30 * 60 * 1000,
} as const;

/**
 * API configuration
 */
export const apiConfig = {
  /** Base URL for API requests */
  baseUrl: process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001',
  /** Request timeout in milliseconds */
  timeoutMs: 30000,
  /** Retry attempts for failed requests */
  retryAttempts: 3,
} as const;

/**
 * Feature flags
 */
export const featureFlags = {
  /** Enable beta features */
  enableBeta: process.env['NEXT_PUBLIC_ENABLE_BETA'] === 'true',
  /** Enable analytics */
  enableAnalytics: process.env['NEXT_PUBLIC_ENABLE_ANALYTICS'] !== 'false',
  /** Enable chat support */
  enableChat: process.env['NEXT_PUBLIC_ENABLE_CHAT'] === 'true',
} as const;

/**
 * Check if running on client side
 */
export const isClient = typeof window !== 'undefined';

/**
 * Check if running on server side
 */
export const isServer = typeof window === 'undefined';

/**
 * Get environment variable with fallback
 */
export function getEnvVar(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`Environment variable ${key} is not defined`);
  }
  return value;
}
