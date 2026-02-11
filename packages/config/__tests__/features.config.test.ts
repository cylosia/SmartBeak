/**
 * Feature Flags Configuration Tests
 *
 * Tests for feature flags secure defaults (all disabled by default).
 * @security P1-CRITICAL
 */

import { vi, type MockInstance } from 'vitest';
import { featureFlags, isFeatureEnabled, getEnabledFeatures, validateFeatureFlags } from '../features';

describe('Feature Flags - Security Defaults', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Clear all feature flag env vars
    const featureFlagVars = [
      'ENABLE_AI',
      'ENABLE_SOCIAL_PUBLISHING',
      'ENABLE_EMAIL_MARKETING',
      'ENABLE_ANALYTICS',
      'ENABLE_AFFILIATE',
      'ENABLE_EXPERIMENTAL',
      'ENABLE_CIRCUIT_BREAKER',
      'ENABLE_RATE_LIMITING',
    ];
    for (const key of featureFlagVars) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  describe('Default Values', () => {
    it('should have all features disabled by default', async () => {
      const { featureFlags: flags } = await import('../features');
      
      expect(flags.enableAI).toBe(false);
      expect(flags.enableSocialPublishing).toBe(false);
      expect(flags.enableEmailMarketing).toBe(false);
      expect(flags.enableAnalytics).toBe(false);
      expect(flags.enableAffiliate).toBe(false);
      expect(flags.enableExperimental).toBe(false);
      expect(flags.enableCircuitBreaker).toBe(false);
      expect(flags.enableRateLimiting).toBe(false);
    });

    it('should enable AI when ENABLE_AI=true', async () => {
      process.env['ENABLE_AI'] = 'true';

      const { featureFlags: flags } = await import('../features');
      
      expect(flags.enableAI).toBe(true);
    });

    it('should enable social publishing when ENABLE_SOCIAL_PUBLISHING=true', async () => {
      process.env['ENABLE_SOCIAL_PUBLISHING'] = 'true';

      const { featureFlags: flags } = await import('../features');
      
      expect(flags.enableSocialPublishing).toBe(true);
    });

    it('should enable email marketing when ENABLE_EMAIL_MARKETING=true', async () => {
      process.env['ENABLE_EMAIL_MARKETING'] = 'true';

      const { featureFlags: flags } = await import('../features');
      
      expect(flags.enableEmailMarketing).toBe(true);
    });

    it('should enable analytics when ENABLE_ANALYTICS=true', async () => {
      process.env['ENABLE_ANALYTICS'] = 'true';

      const { featureFlags: flags } = await import('../features');
      
      expect(flags.enableAnalytics).toBe(true);
    });

    it('should enable affiliate when ENABLE_AFFILIATE=true', async () => {
      process.env['ENABLE_AFFILIATE'] = 'true';

      const { featureFlags: flags } = await import('../features');
      
      expect(flags.enableAffiliate).toBe(true);
    });

    it('should enable experimental when ENABLE_EXPERIMENTAL=true', async () => {
      process.env['ENABLE_EXPERIMENTAL'] = 'true';

      const { featureFlags: flags } = await import('../features');
      
      expect(flags.enableExperimental).toBe(true);
    });

    it('should enable circuit breaker when ENABLE_CIRCUIT_BREAKER=true', async () => {
      process.env['ENABLE_CIRCUIT_BREAKER'] = 'true';

      const { featureFlags: flags } = await import('../features');
      
      expect(flags.enableCircuitBreaker).toBe(true);
    });

    it('should enable rate limiting when ENABLE_RATE_LIMITING=true', async () => {
      process.env['ENABLE_RATE_LIMITING'] = 'true';

      const { featureFlags: flags } = await import('../features');
      
      expect(flags.enableRateLimiting).toBe(true);
    });
  });

  describe('isFeatureEnabled', () => {
    it('should return false for disabled features', async () => {
      const { isFeatureEnabled } = await import('../features');
      
      expect(isFeatureEnabled('enableAI')).toBe(false);
      expect(isFeatureEnabled('enableSocialPublishing')).toBe(false);
    });

    it('should return true for enabled features', async () => {
      process.env['ENABLE_AI'] = 'true';
      process.env['ENABLE_SOCIAL_PUBLISHING'] = 'true';

      const { isFeatureEnabled } = await import('../features');
      
      expect(isFeatureEnabled('enableAI')).toBe(true);
      expect(isFeatureEnabled('enableSocialPublishing')).toBe(true);
    });
  });

  describe('getEnabledFeatures', () => {
    it('should return empty array when no features are enabled', async () => {
      const { getEnabledFeatures } = await import('../features');
      
      expect(getEnabledFeatures()).toEqual([]);
    });

    it('should return array of enabled feature names', async () => {
      process.env['ENABLE_AI'] = 'true';
      process.env['ENABLE_ANALYTICS'] = 'true';

      const { getEnabledFeatures } = await import('../features');
      
      const enabled = getEnabledFeatures();
      expect(enabled).toContain('enableAI');
      expect(enabled).toContain('enableAnalytics');
      expect(enabled).toHaveLength(2);
    });
  });

  describe('validateFeatureFlags', () => {
    let consoleLogSpy: MockInstance;
    let consoleWarnSpy: MockInstance;

    beforeEach(() => {
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation();
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should log message when all features are disabled', async () => {
      const { validateFeatureFlags } = await import('../features');
      
      validateFeatureFlags();
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Feature Flags] All features are disabled (secure default)'
      );
    });

    it('should log enabled features', async () => {
      process.env['ENABLE_AI'] = 'true';
      process.env['ENABLE_ANALYTICS'] = 'true';

      const { validateFeatureFlags } = await import('../features');
      
      validateFeatureFlags();
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('enableAI')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('enableAnalytics')
      );
    });

    it('should warn about experimental features in production', async () => {
      process.env['NODE_ENV'] = 'production';
      process.env['ENABLE_EXPERIMENTAL'] = 'true';

      const { validateFeatureFlags } = await import('../features');
      
      validateFeatureFlags();
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[SECURITY WARNING] Experimental features are enabled in production'
      );
    });

    it('should not warn about experimental features in development', async () => {
      process.env['NODE_ENV'] = 'development';
      process.env['ENABLE_EXPERIMENTAL'] = 'true';

      const { validateFeatureFlags } = await import('../features');
      
      validateFeatureFlags();
      
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        '[SECURITY WARNING] Experimental features are enabled in production'
      );
    });
  });

  describe('Security Assertions', () => {
    it('should not allow features to be enabled by default (previous vulnerability)', async () => {
      // This test documents the security fix
      // Previously, features like enableAI defaulted to true
      const { featureFlags: flags } = await import('../features');
      
      // All features should be disabled without explicit env vars
      const allDisabled = Object.values(flags).every(enabled => enabled === false);
      expect(allDisabled).toBe(true);
    });

    it('should require explicit opt-in for all features', async () => {
      // Verify that no feature is accidentally enabled
      const { featureFlags: flags } = await import('../features');
      
      Object.entries(flags).forEach(([name, enabled]) => {
        expect(enabled).toBe(false);
      });
    });
  });
});
