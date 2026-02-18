/**
 * Configuration Validation Tests
 * 
 * Tests for startup validation and required environment variables.
 * @security P1-CRITICAL
 */

import {
  validateConfig,
  validateEnv,
  validateStartup,
  REQUIRED_ENV_VARS,
} from '../validation';

describe('Configuration Validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  describe('REQUIRED_ENV_VARS', () => {
    it('should include NODE_ENV as required', () => {
      expect(REQUIRED_ENV_VARS).toContain('NODE_ENV');
    });

    it('should include LOG_LEVEL as required', () => {
      expect(REQUIRED_ENV_VARS).toContain('LOG_LEVEL');
    });

    it('should include SERVICE_NAME as required', () => {
      expect(REQUIRED_ENV_VARS).toContain('SERVICE_NAME');
    });

    it('should include existing required vars', () => {
      expect(REQUIRED_ENV_VARS).toContain('CONTROL_PLANE_DB');
      expect(REQUIRED_ENV_VARS).toContain('CLERK_SECRET_KEY');
      expect(REQUIRED_ENV_VARS).toContain('JWT_KEY_1');
      expect(REQUIRED_ENV_VARS).toContain('JWT_KEY_2');
    });
  });

  describe('validateConfig - NODE_ENV', () => {
    it('should fail when NODE_ENV is not set', () => {
      delete process.env['NODE_ENV'];
      
      const result = validateConfig();
      
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('NODE_ENV');
    });

    it('should fail when NODE_ENV is invalid', () => {
      process.env['NODE_ENV'] = 'invalid';
      
      const result = validateConfig();
      
      expect(result.valid).toBe(false);
      expect(result.invalid).toContainEqual({
        key: 'NODE_ENV',
        reason: 'NODE_ENV must be one of: development, production, test',
      });
    });

    it('should pass when NODE_ENV is development', () => {
      process.env['NODE_ENV'] = 'development';
      process.env['LOG_LEVEL'] = 'info';
      process.env['SERVICE_NAME'] = 'test-service';
      
      const result = validateConfig();
      
      // May still fail for other missing vars, but NODE_ENV should be valid
      const nodeEnvInvalid = result.invalid?.find(i => i.key === 'NODE_ENV');
      expect(nodeEnvInvalid).toBeUndefined();
    });

    it('should pass when NODE_ENV is production', () => {
      process.env['NODE_ENV'] = 'production';
      process.env['LOG_LEVEL'] = 'info';
      process.env['SERVICE_NAME'] = 'test-service';
      
      const result = validateConfig();
      
      const nodeEnvInvalid = result.invalid?.find(i => i.key === 'NODE_ENV');
      expect(nodeEnvInvalid).toBeUndefined();
    });

    it('should pass when NODE_ENV is test', () => {
      process.env['NODE_ENV'] = 'test';
      process.env['LOG_LEVEL'] = 'info';
      process.env['SERVICE_NAME'] = 'test-service';
      
      const result = validateConfig();
      
      const nodeEnvInvalid = result.invalid?.find(i => i.key === 'NODE_ENV');
      expect(nodeEnvInvalid).toBeUndefined();
    });
  });

  describe('validateConfig - LOG_LEVEL', () => {
    it('should fail when LOG_LEVEL is not set', () => {
      delete process.env['LOG_LEVEL'];
      
      const result = validateConfig();
      
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('LOG_LEVEL');
    });

    it('should fail when LOG_LEVEL is invalid', () => {
      process.env['LOG_LEVEL'] = 'invalid';
      
      const result = validateConfig();
      
      expect(result.valid).toBe(false);
      expect(result.invalid).toContainEqual({
        key: 'LOG_LEVEL',
        reason: 'LOG_LEVEL must be one of: debug, info, warn, error, silent',
      });
    });

    it('should pass for valid LOG_LEVEL values', () => {
      const validLevels = ['debug', 'info', 'warn', 'error', 'silent'];
      
      for (const level of validLevels) {
        process.env['LOG_LEVEL'] = level;
        process.env['NODE_ENV'] = 'development';
        process.env['SERVICE_NAME'] = 'test-service';
        
        const result = validateConfig();
        
        const logLevelInvalid = result.invalid?.find(i => i.key === 'LOG_LEVEL');
        expect(logLevelInvalid).toBeUndefined();
      }
    });
  });

  describe('validateConfig - SERVICE_NAME', () => {
    it('should fail when SERVICE_NAME is not set', () => {
      delete process.env['SERVICE_NAME'];
      
      const result = validateConfig();
      
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('SERVICE_NAME');
    });

    it('should fail when SERVICE_NAME is too short', () => {
      process.env['SERVICE_NAME'] = 'a';
      
      const result = validateConfig();
      
      expect(result.valid).toBe(false);
      expect(result.invalid).toContainEqual({
        key: 'SERVICE_NAME',
        reason: 'SERVICE_NAME must be at least 2 characters',
      });
    });

    it('should fail when SERVICE_NAME contains invalid characters', () => {
      process.env['SERVICE_NAME'] = 'test service';
      
      const result = validateConfig();
      
      expect(result.valid).toBe(false);
      expect(result.invalid).toContainEqual({
        key: 'SERVICE_NAME',
        reason: 'SERVICE_NAME must contain only alphanumeric characters, hyphens, and underscores',
      });
    });

    it('should pass for valid SERVICE_NAME values', () => {
      const validNames = ['test-service', 'test_service', 'TestService123', 'api-v1'];
      
      for (const name of validNames) {
        process.env['SERVICE_NAME'] = name;
        process.env['NODE_ENV'] = 'development';
        process.env['LOG_LEVEL'] = 'info';
        
        const result = validateConfig();
        
        const serviceNameInvalid = result.invalid?.find(i => i.key === 'SERVICE_NAME');
        expect(serviceNameInvalid).toBeUndefined();
      }
    });
  });

  describe('validateConfig - JWT Keys', () => {
    it('should fail when JWT_KEY_1 and JWT_KEY_2 are identical', () => {
      process.env['JWT_KEY_1'] = 'same-secret-key';
      process.env['JWT_KEY_2'] = 'same-secret-key';
      process.env['NODE_ENV'] = 'development';
      process.env['LOG_LEVEL'] = 'info';
      process.env['SERVICE_NAME'] = 'test-service';
      
      const result = validateConfig();
      
      expect(result.valid).toBe(false);
      expect(result.invalid).toContainEqual({
        key: 'JWT_KEY_2',
        reason: 'JWT_KEY_1 and JWT_KEY_2 must be different values',
      });
    });

    it('should pass when JWT_KEY_1 and JWT_KEY_2 are different', () => {
      process.env['JWT_KEY_1'] = 'secret-key-1';
      process.env['JWT_KEY_2'] = 'secret-key-2';
      process.env['NODE_ENV'] = 'development';
      process.env['LOG_LEVEL'] = 'info';
      process.env['SERVICE_NAME'] = 'test-service';
      
      const result = validateConfig();
      
      const jwtInvalid = result.invalid?.find(i => i.key === 'JWT_KEY_1' || i.key === 'JWT_KEY_2');
      expect(jwtInvalid).toBeUndefined();
    });
  });

  describe('validateEnv', () => {
    it('should throw when required variables are missing', () => {
      // Clear all required vars
      for (const key of REQUIRED_ENV_VARS) {
        delete process.env[key];
      }
      
      expect(() => validateEnv()).toThrow('MISSING_REQUIRED_ENV_VARS');
    });

    it('should throw with detailed error message', () => {
      // Clear all required vars
      for (const key of REQUIRED_ENV_VARS) {
        delete process.env[key];
      }
      
      expect(() => validateEnv()).toThrow('NODE_ENV');
      expect(() => validateEnv()).toThrow('LOG_LEVEL');
      expect(() => validateEnv()).toThrow('SERVICE_NAME');
    });

    it('should not throw when all required variables are set', () => {
      process.env['NODE_ENV'] = 'development';
      process.env['LOG_LEVEL'] = 'info';
      process.env['SERVICE_NAME'] = 'test-service';
      process.env['CONTROL_PLANE_DB'] = 'postgres://localhost/db';
      process.env['CLERK_SECRET_KEY'] = 'sk_test_xxx';
      process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] = 'pk_test_xxx';
      process.env['CLERK_WEBHOOK_SECRET'] = 'whsec_xxx';
      process.env['STRIPE_SECRET_KEY'] = 'sk_test_xxx';
      process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_xxx';
      process.env['JWT_KEY_1'] = 'jwt-secret-1';
      process.env['JWT_KEY_2'] = 'jwt-secret-2';
      // KEY_ENCRYPTION_SECRET is required — must be present or validateEnv() throws
      process.env['KEY_ENCRYPTION_SECRET'] = 'test-encryption-secret-32chars!!';

      expect(() => validateEnv()).not.toThrow();
    });
  });

  describe('validateStartup', () => {
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it('should throw when BCRYPT_ROUNDS is too low in production', () => {
      process.env['NODE_ENV'] = 'production';
      process.env['LOG_LEVEL'] = 'info';
      process.env['SERVICE_NAME'] = 'test-service';
      process.env['CONTROL_PLANE_DB'] = 'postgres://localhost/db';
      process.env['CLERK_SECRET_KEY'] = 'sk_test_xxx';
      process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] = 'pk_test_xxx';
      process.env['CLERK_WEBHOOK_SECRET'] = 'whsec_xxx';
      process.env['STRIPE_SECRET_KEY'] = 'sk_test_xxx';
      process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_xxx';
      process.env['JWT_KEY_1'] = 'jwt-secret-1';
      process.env['JWT_KEY_2'] = 'jwt-secret-2';
      // KEY_ENCRYPTION_SECRET required — without it validateEnv() throws before BCRYPT_ROUNDS is checked
      process.env['KEY_ENCRYPTION_SECRET'] = 'test-encryption-secret-32chars!!';
      process.env['BCRYPT_ROUNDS'] = '8';

      expect(() => validateStartup()).toThrow('STARTUP_VALIDATION_FAILED');
      expect(() => validateStartup()).toThrow('BCRYPT_ROUNDS must be at least 10 in production');
    });

    it('should pass when BCRYPT_ROUNDS is adequate in production', () => {
      process.env['NODE_ENV'] = 'production';
      process.env['LOG_LEVEL'] = 'info';
      process.env['SERVICE_NAME'] = 'test-service';
      process.env['CONTROL_PLANE_DB'] = 'postgres://localhost/db';
      process.env['CLERK_SECRET_KEY'] = 'sk_test_xxx';
      process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] = 'pk_test_xxx';
      process.env['CLERK_WEBHOOK_SECRET'] = 'whsec_xxx';
      process.env['STRIPE_SECRET_KEY'] = 'sk_test_xxx';
      process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_xxx';
      process.env['JWT_KEY_1'] = 'jwt-secret-1';
      process.env['JWT_KEY_2'] = 'jwt-secret-2';
      // KEY_ENCRYPTION_SECRET required — without it validateEnv() throws before BCRYPT_ROUNDS is checked
      process.env['KEY_ENCRYPTION_SECRET'] = 'test-encryption-secret-32chars!!';
      process.env['BCRYPT_ROUNDS'] = '12';

      // Should not throw for BCRYPT_ROUNDS (might throw for other missing security vars)
      expect(() => validateStartup()).not.toThrow(/BCRYPT_ROUNDS/);
    });

    it('should warn when JWT_EXPIRY_SECONDS is too long', () => {
      process.env['NODE_ENV'] = 'development';
      process.env['LOG_LEVEL'] = 'info';
      process.env['SERVICE_NAME'] = 'test-service';
      process.env['CONTROL_PLANE_DB'] = 'postgres://localhost/db';
      process.env['CLERK_SECRET_KEY'] = 'sk_test_xxx';
      process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] = 'pk_test_xxx';
      process.env['CLERK_WEBHOOK_SECRET'] = 'whsec_xxx';
      process.env['STRIPE_SECRET_KEY'] = 'sk_test_xxx';
      process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_xxx';
      process.env['JWT_KEY_1'] = 'jwt-secret-1';
      process.env['JWT_KEY_2'] = 'jwt-secret-2';
      // KEY_ENCRYPTION_SECRET required — without it validateEnv() throws before JWT_EXPIRY_SECONDS is checked
      process.env['KEY_ENCRYPTION_SECRET'] = 'test-encryption-secret-32chars!!';
      process.env['BCRYPT_ROUNDS'] = '12';
      process.env['JWT_EXPIRY_SECONDS'] = '172800'; // 48 hours

      expect(() => validateStartup()).toThrow('STARTUP_VALIDATION_FAILED');
      expect(() => validateStartup()).toThrow('JWT_EXPIRY_SECONDS should not exceed 86400');
    });
  });

  describe('Placeholder Detection', () => {
    it('should detect placeholder values', () => {
      process.env['CLERK_SECRET_KEY'] = 'your_clerk_secret_key';
      process.env['NODE_ENV'] = 'development';
      process.env['LOG_LEVEL'] = 'info';
      process.env['SERVICE_NAME'] = 'test-service';
      
      const result = validateConfig();
      
      expect(result.valid).toBe(false);
      expect(result.placeholders).toContain('CLERK_SECRET_KEY');
    });

    it('should detect "placeholder" text', () => {
      process.env['STRIPE_SECRET_KEY'] = 'placeholder';
      process.env['NODE_ENV'] = 'development';
      process.env['LOG_LEVEL'] = 'info';
      process.env['SERVICE_NAME'] = 'test-service';
      
      const result = validateConfig();
      
      expect(result.valid).toBe(false);
      expect(result.placeholders).toContain('STRIPE_SECRET_KEY');
    });

    it('should detect "test" text', () => {
      process.env['JWT_KEY_1'] = 'test';
      process.env['NODE_ENV'] = 'development';
      process.env['LOG_LEVEL'] = 'info';
      process.env['SERVICE_NAME'] = 'test-service';
      
      const result = validateConfig();
      
      expect(result.valid).toBe(false);
      expect(result.placeholders).toContain('JWT_KEY_1');
    });
  });
});
