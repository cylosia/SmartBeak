/**
 * Security Configuration Tests
 *
 * Tests for security configuration fail-fast behavior.
 * @security P1-CRITICAL
 */

import { vi } from 'vitest';

describe('Security Configuration - Fail Fast', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset module cache to re-evaluate module-level validation
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  describe('BCRYPT_ROUNDS', () => {
    it('should throw when BCRYPT_ROUNDS is not set', () => {
      // Clear all required security env vars
      const requiredVars = [
        'BCRYPT_ROUNDS',
        'JWT_EXPIRY_SECONDS',
        'JWT_CLOCK_TOLERANCE_SECONDS',
        'JWT_MAX_AGE_SECONDS',
        'MAX_FAILED_LOGINS',
        'LOCKOUT_DURATION_MINUTES',
        'RATE_LIMIT_MAX_REQUESTS',
        'RATE_LIMIT_WINDOW_MS',
        'MAX_RATE_LIMIT_STORE_SIZE',
        'RATE_LIMIT_CLEANUP_INTERVAL_MS',
        'ABUSE_MAX_REQUESTS_PER_MINUTE',
        'ABUSE_BLOCK_DURATION_MINUTES',
        'ABUSE_SUSPICIOUS_THRESHOLD',
        'ABUSE_GUARD_ENABLED',
      ];
      
      for (const key of requiredVars) {
        delete process.env[key];
      }

      // Set all except BCRYPT_ROUNDS
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

      expect(() => require('../security')).toThrow('SECURITY_CONFIG_MISSING');
      expect(() => require('../security')).toThrow('BCRYPT_ROUNDS');
    });

    it('should load successfully when all required vars are set', () => {
      // Set all required security env vars
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

      const { securityConfig } = require('../security');
      
      expect(securityConfig.bcryptRounds).toBe(12);
      expect(securityConfig.jwtExpirySeconds).toBe(3600);
    });
  });

  describe('Security Config Values', () => {
    beforeEach(() => {
      // Set all required security env vars
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
    });

    it('should parse bcrypt rounds as integer', () => {
      process.env['BCRYPT_ROUNDS'] = '14';
      
      const { securityConfig } = require('../security');
      
      expect(securityConfig.bcryptRounds).toBe(14);
    });

    it('should parse JWT expiry as integer', () => {
      process.env['JWT_EXPIRY_SECONDS'] = '7200';
      
      const { securityConfig } = require('../security');
      
      expect(securityConfig.jwtExpirySeconds).toBe(7200);
    });

    it('should parse max failed logins as integer', () => {
      process.env['MAX_FAILED_LOGINS'] = '3';
      
      const { securityConfig } = require('../security');
      
      expect(securityConfig.maxFailedLogins).toBe(3);
    });

    it('should throw for invalid bcrypt rounds', () => {
      process.env['BCRYPT_ROUNDS'] = 'invalid';
      
      expect(() => require('../security')).toThrow();
    });
  });

  describe('Abuse Guard Config', () => {
    beforeEach(() => {
      // Set all required security env vars
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
    });

    it('should require ABUSE_MAX_REQUESTS_PER_MINUTE', () => {
      delete process.env['ABUSE_MAX_REQUESTS_PER_MINUTE'];
      
      expect(() => require('../security')).toThrow('ABUSE_GUARD_CONFIG_MISSING');
    });

    it('should require ABUSE_BLOCK_DURATION_MINUTES', () => {
      delete process.env['ABUSE_BLOCK_DURATION_MINUTES'];
      
      expect(() => require('../security')).toThrow('ABUSE_GUARD_CONFIG_MISSING');
    });

    it('should require ABUSE_SUSPICIOUS_THRESHOLD', () => {
      delete process.env['ABUSE_SUSPICIOUS_THRESHOLD'];
      
      expect(() => require('../security')).toThrow('ABUSE_GUARD_CONFIG_MISSING');
    });

    it('should require ABUSE_GUARD_ENABLED', () => {
      delete process.env['ABUSE_GUARD_ENABLED'];
      
      expect(() => require('../security')).toThrow('ABUSE_GUARD_CONFIG_MISSING');
    });

    it('should enable abuse guard when ABUSE_GUARD_ENABLED is "true"', () => {
      process.env['ABUSE_GUARD_ENABLED'] = 'true';
      
      const { abuseGuardConfig } = require('../security');
      
      expect(abuseGuardConfig.enabled).toBe(true);
    });

    it('should disable abuse guard when ABUSE_GUARD_ENABLED is not "true"', () => {
      process.env['ABUSE_GUARD_ENABLED'] = 'false';
      
      const { abuseGuardConfig } = require('../security');
      
      expect(abuseGuardConfig.enabled).toBe(false);
    });
  });
});
