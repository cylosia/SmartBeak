/**
 * Startup Validation Integration Tests
 * 
 * Tests for complete startup validation flow.
 * @security P1-CRITICAL
 */

import { vi } from 'vitest';
import { validateStartup } from '../validation';

describe('Startup Validation - Integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  /**
   * Sets all required environment variables for a valid startup
   */
  function setValidEnvironment(): void {
    // Core required vars
    process.env['NODE_ENV'] = 'development';
    process.env['LOG_LEVEL'] = 'info';
    process.env['SERVICE_NAME'] = 'test-service';
    
    // Database
    process.env['CONTROL_PLANE_DB'] = 'postgres://localhost:5432/testdb';
    
    // Auth
    process.env['CLERK_SECRET_KEY'] = 'sk_test_valid_clerk_key_123';
    process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] = 'pk_test_valid_clerk_key_456';
    process.env['CLERK_WEBHOOK_SECRET'] = 'whsec_valid_webhook_secret_789';
    
    // Payments
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_valid_stripe_key_abc';
    process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_valid_stripe_webhook_def';
    
    // JWT
    process.env['JWT_KEY_1'] = 'valid-jwt-secret-key-number-one-32chars';
    process.env['JWT_KEY_2'] = 'valid-jwt-secret-key-number-two-32charsx';
    
    // Security config (required for security.ts)
    process.env['BCRYPT_ROUNDS'] = '12';
    process.env['JWT_EXPIRY_SECONDS'] = '3600';
    process.env['JWT_CLOCK_TOLERANCE_SECONDS'] = '30';
    process.env['JWT_MAX_AGE_SECONDS'] = '604800';
    process.env['MAX_FAILED_LOGINS'] = '5';
    process.env['LOCKOUT_DURATION_MINUTES'] = '30';
    process.env['RATE_LIMIT_MAX_REQUESTS'] = '100';
    process.env['RATE_LIMIT_WINDOW_MS'] = '60000';
    process.env['MAX_RATE_LIMIT_STORE_SIZE'] = '100000';
    process.env['RATE_LIMIT_CLEANUP_INTERVAL_MS'] = '300000';
    process.env['ABUSE_MAX_REQUESTS_PER_MINUTE'] = '100';
    process.env['ABUSE_BLOCK_DURATION_MINUTES'] = '60';
    process.env['ABUSE_SUSPICIOUS_THRESHOLD'] = '80';
    process.env['ABUSE_GUARD_ENABLED'] = 'true';
  }

  describe('Happy Path', () => {
    it('should pass validation with all required vars set', () => {
      setValidEnvironment();
      
      expect(() => validateStartup()).not.toThrow();
    });

    it('should log success message', () => {
      setValidEnvironment();
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      validateStartup();
      
      expect(consoleLogSpy).toHaveBeenCalledWith('[Config] Running startup validation...');
      expect(consoleLogSpy).toHaveBeenCalledWith('[Config] Environment validation passed');
      expect(consoleLogSpy).toHaveBeenCalledWith('[Config] Startup validation passed');
      
      consoleLogSpy.mockRestore();
    });
  });

  describe('Missing Critical Config', () => {
    it('should fail fast when NODE_ENV is missing', () => {
      setValidEnvironment();
      delete process.env['NODE_ENV'];
      
      expect(() => validateStartup()).toThrow('MISSING_REQUIRED_ENV_VARS');
      expect(() => validateStartup()).toThrow('NODE_ENV');
    });

    it('should fail fast when LOG_LEVEL is missing', () => {
      setValidEnvironment();
      delete process.env['LOG_LEVEL'];
      
      expect(() => validateStartup()).toThrow('MISSING_REQUIRED_ENV_VARS');
      expect(() => validateStartup()).toThrow('LOG_LEVEL');
    });

    it('should fail fast when SERVICE_NAME is missing', () => {
      setValidEnvironment();
      delete process.env['SERVICE_NAME'];
      
      expect(() => validateStartup()).toThrow('MISSING_REQUIRED_ENV_VARS');
      expect(() => validateStartup()).toThrow('SERVICE_NAME');
    });

    it('should fail fast when CLERK_SECRET_KEY is missing', () => {
      setValidEnvironment();
      delete process.env['CLERK_SECRET_KEY'];
      
      expect(() => validateStartup()).toThrow('MISSING_REQUIRED_ENV_VARS');
      expect(() => validateStartup()).toThrow('CLERK_SECRET_KEY');
    });

    it('should fail fast when STRIPE_SECRET_KEY is missing', () => {
      setValidEnvironment();
      delete process.env['STRIPE_SECRET_KEY'];
      
      expect(() => validateStartup()).toThrow('MISSING_REQUIRED_ENV_VARS');
      expect(() => validateStartup()).toThrow('STRIPE_SECRET_KEY');
    });

    it('should fail fast when JWT_KEY_1 is missing', () => {
      setValidEnvironment();
      delete process.env['JWT_KEY_1'];
      
      expect(() => validateStartup()).toThrow('MISSING_REQUIRED_ENV_VARS');
      expect(() => validateStartup()).toThrow('JWT_KEY_1');
    });

    it('should fail fast when JWT_KEY_2 is missing', () => {
      setValidEnvironment();
      delete process.env['JWT_KEY_2'];
      
      expect(() => validateStartup()).toThrow('MISSING_REQUIRED_ENV_VARS');
      expect(() => validateStartup()).toThrow('JWT_KEY_2');
    });
  });

  describe('Invalid Config Values', () => {
    it('should fail when NODE_ENV is invalid', () => {
      setValidEnvironment();
      process.env['NODE_ENV'] = 'staging';
      
      expect(() => validateStartup()).toThrow('MISSING_REQUIRED_ENV_VARS');
      expect(() => validateStartup()).toThrow('NODE_ENV');
    });

    it('should fail when LOG_LEVEL is invalid', () => {
      setValidEnvironment();
      process.env['LOG_LEVEL'] = 'verbose';
      
      expect(() => validateStartup()).toThrow('MISSING_REQUIRED_ENV_VARS');
      expect(() => validateStartup()).toThrow('LOG_LEVEL');
    });

    it('should fail when SERVICE_NAME has spaces', () => {
      setValidEnvironment();
      process.env['SERVICE_NAME'] = 'my service';
      
      expect(() => validateStartup()).toThrow('MISSING_REQUIRED_ENV_VARS');
      expect(() => validateStartup()).toThrow('SERVICE_NAME');
    });

    it('should fail when JWT keys are identical', () => {
      setValidEnvironment();
      process.env['JWT_KEY_1'] = 'same-secret-key';
      process.env['JWT_KEY_2'] = 'same-secret-key';
      
      expect(() => validateStartup()).toThrow('MISSING_REQUIRED_ENV_VARS');
      expect(() => validateStartup()).toThrow('JWT_KEY_2');
    });
  });

  describe('Security Config Validation', () => {
    it('should fail when BCRYPT_ROUNDS is missing', () => {
      setValidEnvironment();
      delete process.env['BCRYPT_ROUNDS'];
      
      // Note: This will throw from security.ts module load, not validateStartup
      // But startup validation should also check this
      expect(() => validateStartup()).toThrow();
    });

    it('should fail when JWT_EXPIRY_SECONDS is too long', () => {
      setValidEnvironment();
      process.env['JWT_EXPIRY_SECONDS'] = '604800'; // 1 week
      
      expect(() => validateStartup()).toThrow('STARTUP_VALIDATION_FAILED');
      expect(() => validateStartup()).toThrow('JWT_EXPIRY_SECONDS');
    });

    it('should fail when BCRYPT_ROUNDS is too low in production', () => {
      setValidEnvironment();
      process.env['NODE_ENV'] = 'production';
      process.env['BCRYPT_ROUNDS'] = '8';
      
      expect(() => validateStartup()).toThrow('STARTUP_VALIDATION_FAILED');
      expect(() => validateStartup()).toThrow('BCRYPT_ROUNDS');
    });
  });

  describe('Multiple Missing Variables', () => {
    it('should report all missing variables in error', () => {
      // Clear everything
      for (const key of Object.keys(process.env)) {
        if (key !== 'PATH' && key !== 'SystemRoot') {
          delete process.env[key];
        }
      }
      
      try {
        validateStartup();
        fail('Expected validateStartup to throw');
      } catch (error: unknown) {
        const errorMessage = (error as Error).message;
        expect(errorMessage).toContain('MISSING_REQUIRED_ENV_VARS');
        expect(errorMessage).toContain('NODE_ENV');
        expect(errorMessage).toContain('LOG_LEVEL');
        expect(errorMessage).toContain('SERVICE_NAME');
      }
    });
  });
});
