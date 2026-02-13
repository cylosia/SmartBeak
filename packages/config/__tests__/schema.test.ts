/**
 * Environment Validation Schema Tests
 *
 * Tests for the Zod-based environment validation schema.
 */

import { envSchema } from '../schema';

/** Minimal valid environment for required fields */
function validEnv() {
  return {
    NODE_ENV: 'development',
    LOG_LEVEL: 'info',
    SERVICE_NAME: 'smartbeak-api',
    CONTROL_PLANE_DB: 'postgresql://localhost:5432/smartbeak',
    CLERK_SECRET_KEY: 'clerk_key_abc123def456ghi789jkl012',
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'clerk_pub_abc123def456ghi789jkl012',
    CLERK_WEBHOOK_SECRET: 'clerk_wh_abc123def456ghi789jkl012',
    STRIPE_SECRET_KEY: 'stripe_key_abc123def456ghi789jkl012',
    STRIPE_WEBHOOK_SECRET: 'stripe_wh_abc123def456ghi789jkl012',
    JWT_KEY_1: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    JWT_KEY_2: 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3',
    KEY_ENCRYPTION_SECRET: 'enc_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
  };
}

describe('envSchema', () => {
  describe('valid environment', () => {
    it('should parse a valid environment successfully', () => {
      const result = envSchema.safeParse(validEnv());
      expect(result.success).toBe(true);
    });

    it('should accept optional fields when present', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        PORT: '3001',
        REDIS_URL: 'redis://localhost:6379',
        OPENAI_API_KEY: 'sk-proj-abc123def456ghi789jkl012mno345',
      });
      expect(result.success).toBe(true);
    });

    it('should coerce PORT to a number', () => {
      const result = envSchema.safeParse({ ...validEnv(), PORT: '8080' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORT).toBe(8080);
      }
    });
  });

  describe('required field validation', () => {
    it('should reject missing NODE_ENV', () => {
      const env = validEnv();
      delete (env as Record<string, unknown>).NODE_ENV;
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should reject missing CONTROL_PLANE_DB', () => {
      const env = validEnv();
      delete (env as Record<string, unknown>).CONTROL_PLANE_DB;
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should reject missing JWT_KEY_1', () => {
      const env = validEnv();
      delete (env as Record<string, unknown>).JWT_KEY_1;
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe('format validation', () => {
    it('should reject invalid NODE_ENV values', () => {
      const result = envSchema.safeParse({ ...validEnv(), NODE_ENV: 'staging' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid LOG_LEVEL values', () => {
      const result = envSchema.safeParse({ ...validEnv(), LOG_LEVEL: 'verbose' });
      expect(result.success).toBe(false);
    });

    it('should reject SERVICE_NAME with special characters', () => {
      const result = envSchema.safeParse({ ...validEnv(), SERVICE_NAME: 'my service!' });
      expect(result.success).toBe(false);
    });

    it('should reject SERVICE_NAME that is too short', () => {
      const result = envSchema.safeParse({ ...validEnv(), SERVICE_NAME: 'a' });
      expect(result.success).toBe(false);
    });

    it('should accept valid NODE_ENV values', () => {
      for (const env of ['development', 'production', 'test']) {
        const result = envSchema.safeParse({ ...validEnv(), NODE_ENV: env });
        expect(result.success).toBe(true);
      }
    });

    it('should accept valid LOG_LEVEL values', () => {
      for (const level of ['debug', 'info', 'warn', 'error', 'silent']) {
        const result = envSchema.safeParse({ ...validEnv(), LOG_LEVEL: level });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('security validation', () => {
    it('should reject when JWT_KEY_1 equals JWT_KEY_2', () => {
      const sameKey = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
      const result = envSchema.safeParse({
        ...validEnv(),
        JWT_KEY_1: sameKey,
        JWT_KEY_2: sameKey,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const jwtError = result.error.issues.find(i => i.path.includes('JWT_KEY_2'));
        expect(jwtError).toBeDefined();
        expect(jwtError?.message).toContain('different');
      }
    });

    it('should reject secrets that are too short', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        CLERK_SECRET_KEY: 'short',
      });
      expect(result.success).toBe(false);
    });

    it('should reject placeholder values in secrets', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        CLERK_SECRET_KEY: 'your_clerk_secret_key_placeholder_value',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('optional field validation', () => {
    it('should accept missing optional fields', () => {
      const result = envSchema.safeParse(validEnv());
      expect(result.success).toBe(true);
    });

    it('should accept valid feature flag values', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        ENABLE_AI: 'true',
        ENABLE_CIRCUIT_BREAKER: 'false',
        ENABLE_RATE_LIMITING: '1',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid feature flag values', () => {
      const result = envSchema.safeParse({
        ...validEnv(),
        ENABLE_AI: 'yes',
      });
      expect(result.success).toBe(false);
    });
  });
});
