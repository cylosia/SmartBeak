/**
 * Web App Configuration — Re-export Shim
 *
 * All configuration is centralized in @config (packages/config/).
 * This file re-exports for web-app convenience and adds web-specific helpers.
 *
 * @deprecated Import directly from '@config' for new code.
 */

export {
  featureFlags,
  isFeatureEnabled,
  apiConfig,
  securityConfig,
  getEnvVar,
} from '@config';

/**
 * Check if running on client side
 */
export const isClient = typeof window !== 'undefined';

/**
 * Check if running on server side
 */
export const isServer = typeof window === 'undefined';
