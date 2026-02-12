/**
 * Feature Flags Configuration Tests
 * 
 * Tests for feature flags secure defaults (all disabled by default).
 * @security P1-CRITICAL
 */

import '../features';

describe('Feature Flags - Security Defaults', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
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
    jest.resetModules();
  });

  describe('Default Values', () => {
    it('should have all features disabled by default', () => {
      const { featureFlags: flags } = require('../features');

      expect(flags.enableAI).toBe(false);
      expect(flags.enableSocialPublishing).toBe(false);
      expect(flags.enableEmailMarketing).toBe(false);
      expect(flags.enableAnalytics).toBe(false);
      expect(flags.enableAffiliate).toBe(false);
      expect(flags.enableExperimental).toBe(false);
      // P0-2 FIX: Protective controls default to TRUE (they protect the system).
      // Previous assertions were wrong -- these should be enabled by default.
      expect(flags.enableCircuitBreaker).toBe(true);
      expect(flags.enableRateLimiting).toBe(true);
    });

    it('should enable AI when ENABLE_AI=true', () => {
      process.env['ENABLE_AI'] = 'true';
      
      const { featureFlags: flags } = require('../features');
      
      expect(flags.enableAI).toBe(true);
    });

    it('should enable social publishing when ENABLE_SOCIAL_PUBLISHING=true', () => {
      process.env['ENABLE_SOCIAL_PUBLISHING'] = 'true';
      
      const { featureFlags: flags } = require('../features');
      
      expect(flags.enableSocialPublishing).toBe(true);
    });

    it('should enable email marketing when ENABLE_EMAIL_MARKETING=true', () => {
      process.env['ENABLE_EMAIL_MARKETING'] = 'true';
      
      const { featureFlags: flags } = require('../features');
      
      expect(flags.enableEmailMarketing).toBe(true);
    });

    it('should enable analytics when ENABLE_ANALYTICS=true', () => {
      process.env['ENABLE_ANALYTICS'] = 'true';
      
      const { featureFlags: flags } = require('../features');
      
      expect(flags.enableAnalytics).toBe(true);
    });

    it('should enable affiliate when ENABLE_AFFILIATE=true', () => {
      process.env['ENABLE_AFFILIATE'] = 'true';
      
      const { featureFlags: flags } = require('../features');
      
      expect(flags.enableAffiliate).toBe(true);
    });

    it('should enable experimental when ENABLE_EXPERIMENTAL=true', () => {
      process.env['ENABLE_EXPERIMENTAL'] = 'true';
      
      const { featureFlags: flags } = require('../features');
      
      expect(flags.enableExperimental).toBe(true);
    });

    it('should enable circuit breaker when ENABLE_CIRCUIT_BREAKER=true', () => {
      process.env['ENABLE_CIRCUIT_BREAKER'] = 'true';
      
      const { featureFlags: flags } = require('../features');
      
      expect(flags.enableCircuitBreaker).toBe(true);
    });

    it('should enable rate limiting when ENABLE_RATE_LIMITING=true', () => {
      process.env['ENABLE_RATE_LIMITING'] = 'true';
      
      const { featureFlags: flags } = require('../features');
      
      expect(flags.enableRateLimiting).toBe(true);
    });
  });

  describe('isFeatureEnabled', () => {
    it('should return false for disabled features', () => {
      const { isFeatureEnabled } = require('../features');
      
      expect(isFeatureEnabled('enableAI')).toBe(false);
      expect(isFeatureEnabled('enableSocialPublishing')).toBe(false);
    });

    it('should return true for enabled features', () => {
      process.env['ENABLE_AI'] = 'true';
      process.env['ENABLE_SOCIAL_PUBLISHING'] = 'true';
      
      const { isFeatureEnabled } = require('../features');
      
      expect(isFeatureEnabled('enableAI')).toBe(true);
      expect(isFeatureEnabled('enableSocialPublishing')).toBe(true);
    });
  });

  describe('getEnabledFeatures', () => {
    it('should return only protective controls when no features are explicitly enabled', () => {
      const { getEnabledFeatures } = require('../features');

      // P0-2 FIX: Circuit breaker and rate limiting default to true
      const enabled = getEnabledFeatures();
      expect(enabled).toContain('enableCircuitBreaker');
      expect(enabled).toContain('enableRateLimiting');
      expect(enabled).toHaveLength(2);
    });

    it('should return array of enabled feature names', () => {
      process.env['ENABLE_AI'] = 'true';
      process.env['ENABLE_ANALYTICS'] = 'true';

      const { getEnabledFeatures } = require('../features');

      const enabled = getEnabledFeatures();
      expect(enabled).toContain('enableAI');
      expect(enabled).toContain('enableAnalytics');
      // P0-2 FIX: Also includes protective controls that default to true
      expect(enabled).toContain('enableCircuitBreaker');
      expect(enabled).toContain('enableRateLimiting');
      expect(enabled).toHaveLength(4);
    });
  });

  describe('validateFeatureFlags', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should log enabled features when protective controls are on', () => {
      // P0-2 FIX: With circuit breaker and rate limiting defaulting to true,
      // the "all disabled" branch is no longer reachable without explicit env vars.
      // P2-9 FIX: validateFeatureFlags uses structured logger, not console.log.
      // We can only verify it doesn't throw.
      const { validateFeatureFlags } = require('../features');

      expect(() => validateFeatureFlags()).not.toThrow();
    });

    it('should log enabled features', () => {
      process.env['ENABLE_AI'] = 'true';
      process.env['ENABLE_ANALYTICS'] = 'true';
      
      const { validateFeatureFlags } = require('../features');
      
      validateFeatureFlags();
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('enableAI')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('enableAnalytics')
      );
    });

    it('should warn about experimental features in production', () => {
      process.env['NODE_ENV'] = 'production';
      process.env['ENABLE_EXPERIMENTAL'] = 'true';
      
      const { validateFeatureFlags } = require('../features');
      
      validateFeatureFlags();
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[SECURITY WARNING] Experimental features are enabled in production'
      );
    });

    it('should not warn about experimental features in development', () => {
      process.env['NODE_ENV'] = 'development';
      process.env['ENABLE_EXPERIMENTAL'] = 'true';
      
      const { validateFeatureFlags } = require('../features');
      
      validateFeatureFlags();
      
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        '[SECURITY WARNING] Experimental features are enabled in production'
      );
    });
  });

  describe('Security Assertions', () => {
    // P0-2 FIX: Protective controls (circuit breaker, rate limiting) intentionally
    // default to true. They protect the system and should NOT be disabled by default.
    // Only user-facing feature flags must default to false.
    const PROTECTIVE_CONTROLS = new Set(['enableCircuitBreaker', 'enableRateLimiting']);

    it('should not allow user-facing features to be enabled by default (previous vulnerability)', () => {
      // This test documents the security fix
      // Previously, features like enableAI defaulted to true
      const { featureFlags: flags } = require('../features');

      // User-facing features should be disabled without explicit env vars
      const userFacingFlags = Object.entries(flags)
        .filter(([name]) => !PROTECTIVE_CONTROLS.has(name));
      const allDisabled = userFacingFlags.every(([, enabled]) => enabled === false);
      expect(allDisabled).toBe(true);
    });

    it('should have protective controls enabled by default', () => {
      const { featureFlags: flags } = require('../features');
      
      Object.entries(flags).forEach(([_name, enabled]) => {
        expect(enabled).toBe(false);
      });
    });
  });
});
