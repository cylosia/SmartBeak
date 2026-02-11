/**
 * Feature Flags Configuration
 * 
 * SECURITY HARDENING: All feature flags now default to false.
 * Features must be explicitly enabled via environment variables.
 * This prevents accidental exposure of unfinished or sensitive features.
 * 
 * @security CRITICAL - These settings control access to platform capabilities
 */

import { parseBoolEnv } from './env';
import { getLogger } from '../kernel/logger';

const logger = getLogger('FeatureFlags');

/**
 * Feature flags with secure defaults (all disabled by default)
 * SECURITY FIX: Changed all defaults from true to false
 */
export const featureFlags = {
  /** Enable AI content generation features - defaults to false for security */
  enableAI: parseBoolEnv('ENABLE_AI', false),

  /** Enable social media publishing features - defaults to false for security */
  enableSocialPublishing: parseBoolEnv('ENABLE_SOCIAL_PUBLISHING', false),

  /** Enable email marketing features - defaults to false for security */
  enableEmailMarketing: parseBoolEnv('ENABLE_EMAIL_MARKETING', false),

  /** Enable analytics features - defaults to false for security */
  enableAnalytics: parseBoolEnv('ENABLE_ANALYTICS', false),

  /** Enable affiliate features - defaults to false for security */
  enableAffiliate: parseBoolEnv('ENABLE_AFFILIATE', false),

  /** Enable experimental features - defaults to false for security */
  enableExperimental: parseBoolEnv('ENABLE_EXPERIMENTAL', false),

  /** Enable circuit breaker pattern - defaults to false for security */
  enableCircuitBreaker: parseBoolEnv('ENABLE_CIRCUIT_BREAKER', false),

  /** Enable rate limiting - defaults to false for security */
  enableRateLimiting: parseBoolEnv('ENABLE_RATE_LIMITING', false),
} as const;

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(feature: keyof typeof featureFlags): boolean {
  return featureFlags[feature];
}

/**
 * Gets all enabled features for logging/auditing
 */
export function getEnabledFeatures(): string[] {
  return Object.entries(featureFlags)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

/**
 * Validates that feature flags are properly configured
 * Logs warnings for enabled features in production
 */
export function validateFeatureFlags(): void {
  const enabled = getEnabledFeatures();
  
  if (enabled.length > 0) {
    logger.info(`[Feature Flags] Enabled features: ${enabled.join(', ')}`);
    
    // Warn about experimental features in production
    if (process.env['NODE_ENV'] === 'production') {
      if (featureFlags.enableExperimental) {
        logger.warn('[SECURITY WARNING] Experimental features are enabled in production');
      }
      if (featureFlags.enableAI) {
        logger.info('[Feature Flags] AI features are enabled');
      }
    }
  } else {
    logger.info('[Feature Flags] All features are disabled (secure default)');
  }
}
