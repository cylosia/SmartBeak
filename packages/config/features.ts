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
import { getLogger } from '@kernel/logger';

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

  /** Enable beta features (web) - defaults to false for security */
  enableBeta: parseBoolEnv('NEXT_PUBLIC_ENABLE_BETA', false),

  /** Enable chat support (web) - defaults to false for security */
  enableChat: parseBoolEnv('NEXT_PUBLIC_ENABLE_CHAT', false),

  /** Enable circuit breaker pattern - defaults to true (protective control) */
  enableCircuitBreaker: parseBoolEnv('ENABLE_CIRCUIT_BREAKER', true),

  /** Enable rate limiting - defaults to true (protective control) */
  enableRateLimiting: parseBoolEnv('ENABLE_RATE_LIMITING', true),
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
    // P2 FIX: Use structured logging with a separate `enabled` field instead of
    // template-literal concatenation. This makes the list machine-parseable by
    // log aggregators and avoids comma-separated strings that are ambiguous when
    // feature names themselves contain commas (unlikely, but prevented by schema).
    logger.info('Feature flags initialized', { enabled });

    // Warn about experimental features in production
    if (process.env['NODE_ENV'] === 'production') {
      if (featureFlags.enableExperimental) {
        logger.warn('SECURITY WARNING: experimental features are enabled in production', { flag: 'enableExperimental' });
      }
      if (featureFlags.enableAI) {
        logger.info('AI features are enabled in production', { flag: 'enableAI' });
      }
    }
  } else {
    logger.info('Feature flags initialized: all features are disabled (secure default)');
  }
}
