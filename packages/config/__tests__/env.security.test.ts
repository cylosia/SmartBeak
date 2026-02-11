/**
 * Environment Utilities Security Tests
 * 
 * Tests for security-critical environment variable parsing functions.
 * @security P1-CRITICAL
 */

import { requireIntEnv, parseBoolEnv, requireBoolEnv } from '../env';

describe('Environment Utilities - Security', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('requireIntEnv', () => {
    it('should throw when environment variable is not set', () => {
      delete process.env['TEST_INT_VAR'];
      
      expect(() => requireIntEnv('TEST_INT_VAR')).toThrow(
        'Required environment variable TEST_INT_VAR is not set'
      );
    });

    it('should throw when environment variable is empty string', () => {
      process.env['TEST_INT_VAR'] = '';
      
      expect(() => requireIntEnv('TEST_INT_VAR')).toThrow(
        'Required environment variable TEST_INT_VAR is not set'
      );
    });

    it('should throw when environment variable is not a valid integer', () => {
      process.env['TEST_INT_VAR'] = 'not-a-number';
      
      expect(() => requireIntEnv('TEST_INT_VAR')).toThrow(
        'Environment variable TEST_INT_VAR must be a valid integer'
      );
    });

    it('should throw when environment variable is a float', () => {
      process.env['TEST_INT_VAR'] = '3.14';
      
      expect(() => requireIntEnv('TEST_INT_VAR')).toThrow(
        'Environment variable TEST_INT_VAR must be a valid integer'
      );
    });

    it('should return integer when environment variable is valid', () => {
      process.env['TEST_INT_VAR'] = '42';
      
      const result = requireIntEnv('TEST_INT_VAR');
      
      expect(result).toBe(42);
    });

    it('should handle zero correctly', () => {
      process.env['TEST_INT_VAR'] = '0';
      
      const result = requireIntEnv('TEST_INT_VAR');
      
      expect(result).toBe(0);
    });

    it('should handle negative integers', () => {
      process.env['TEST_INT_VAR'] = '-10';
      
      const result = requireIntEnv('TEST_INT_VAR');
      
      expect(result).toBe(-10);
    });
  });

  describe('parseBoolEnv - Security Defaults', () => {
    it('should return default value when environment variable is not set', () => {
      delete process.env['TEST_BOOL_VAR'];
      
      const result = parseBoolEnv('TEST_BOOL_VAR', false);
      
      expect(result).toBe(false);
    });

    it('should return true when environment variable is "true"', () => {
      process.env['TEST_BOOL_VAR'] = 'true';
      
      const result = parseBoolEnv('TEST_BOOL_VAR', false);
      
      expect(result).toBe(true);
    });

    it('should return true when environment variable is "1"', () => {
      process.env['TEST_BOOL_VAR'] = '1';
      
      const result = parseBoolEnv('TEST_BOOL_VAR', false);
      
      expect(result).toBe(true);
    });

    it('should return false when environment variable is "false"', () => {
      process.env['TEST_BOOL_VAR'] = 'false';
      
      const result = parseBoolEnv('TEST_BOOL_VAR', true);
      
      expect(result).toBe(false);
    });

    it('should return false when environment variable is "0"', () => {
      process.env['TEST_BOOL_VAR'] = '0';
      
      const result = parseBoolEnv('TEST_BOOL_VAR', true);
      
      expect(result).toBe(false);
    });

    it('should handle case-insensitive "TRUE"', () => {
      process.env['TEST_BOOL_VAR'] = 'TRUE';
      
      const result = parseBoolEnv('TEST_BOOL_VAR', false);
      
      expect(result).toBe(true);
    });

    it('should handle case-insensitive "FALSE"', () => {
      process.env['TEST_BOOL_VAR'] = 'FALSE';
      
      const result = parseBoolEnv('TEST_BOOL_VAR', true);
      
      expect(result).toBe(false);
    });
  });

  describe('requireBoolEnv', () => {
    it('should throw when environment variable is not set', () => {
      delete process.env['TEST_REQ_BOOL_VAR'];
      
      expect(() => requireBoolEnv('TEST_REQ_BOOL_VAR')).toThrow(
        'Required environment variable TEST_REQ_BOOL_VAR is not set'
      );
    });

    it('should throw when environment variable is empty string', () => {
      process.env['TEST_REQ_BOOL_VAR'] = '';
      
      expect(() => requireBoolEnv('TEST_REQ_BOOL_VAR')).toThrow(
        'Required environment variable TEST_REQ_BOOL_VAR is not set'
      );
    });

    it('should throw when environment variable is invalid', () => {
      process.env['TEST_REQ_BOOL_VAR'] = 'yes';
      
      expect(() => requireBoolEnv('TEST_REQ_BOOL_VAR')).toThrow(
        'Environment variable TEST_REQ_BOOL_VAR must be \'true\', \'false\', \'1\', or \'0\''
      );
    });

    it('should return true when environment variable is "true"', () => {
      process.env['TEST_REQ_BOOL_VAR'] = 'true';
      
      const result = requireBoolEnv('TEST_REQ_BOOL_VAR');
      
      expect(result).toBe(true);
    });

    it('should return true when environment variable is "1"', () => {
      process.env['TEST_REQ_BOOL_VAR'] = '1';
      
      const result = requireBoolEnv('TEST_REQ_BOOL_VAR');
      
      expect(result).toBe(true);
    });

    it('should return false when environment variable is "false"', () => {
      process.env['TEST_REQ_BOOL_VAR'] = 'false';
      
      const result = requireBoolEnv('TEST_REQ_BOOL_VAR');
      
      expect(result).toBe(false);
    });

    it('should return false when environment variable is "0"', () => {
      process.env['TEST_REQ_BOOL_VAR'] = '0';
      
      const result = requireBoolEnv('TEST_REQ_BOOL_VAR');
      
      expect(result).toBe(false);
    });

    it('should handle case-insensitive "TRUE"', () => {
      process.env['TEST_REQ_BOOL_VAR'] = 'TRUE';
      
      const result = requireBoolEnv('TEST_REQ_BOOL_VAR');
      
      expect(result).toBe(true);
    });

    it('should handle case-insensitive "FALSE"', () => {
      process.env['TEST_REQ_BOOL_VAR'] = 'FALSE';
      
      const result = requireBoolEnv('TEST_REQ_BOOL_VAR');
      
      expect(result).toBe(false);
    });
  });
});
