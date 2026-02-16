/**
 * Secrets Management Tests
 *
 * Tests for the secrets manifest, feature-to-secret mapping, and strength validation.
 */

import {
  SECRET_MANIFEST,
  getSecretsForFeature,
  getRequiredSecretCategories,
  validateSecretStrength,
} from '../secrets';

describe('SECRET_MANIFEST', () => {
  it('should define all expected categories', () => {
    const categories = Object.keys(SECRET_MANIFEST);
    expect(categories).toContain('core');
    expect(categories).toContain('auth');
    expect(categories).toContain('payments');
    expect(categories).toContain('email');
    expect(categories).toContain('social');
    expect(categories).toContain('affiliate');
    expect(categories).toContain('search');
    expect(categories).toContain('ai');
    expect(categories).toContain('storage');
    expect(categories).toContain('monitoring');
    expect(categories).toContain('deployment');
  });

  it('should mark core, auth, and payments as required', () => {
    expect(SECRET_MANIFEST.core.required).toBe(true);
    expect(SECRET_MANIFEST.auth.required).toBe(true);
    expect(SECRET_MANIFEST.payments.required).toBe(true);
  });

  it('should mark optional categories as not required', () => {
    expect(SECRET_MANIFEST.email.required).toBe(false);
    expect(SECRET_MANIFEST.social.required).toBe(false);
    expect(SECRET_MANIFEST.affiliate.required).toBe(false);
    expect(SECRET_MANIFEST.ai.required).toBe(false);
  });

  it('should include JWT keys in core secrets', () => {
    expect(SECRET_MANIFEST.core.vars).toContain('JWT_KEY_1');
    expect(SECRET_MANIFEST.core.vars).toContain('JWT_KEY_2');
    expect(SECRET_MANIFEST.core.vars).toContain('KEY_ENCRYPTION_SECRET');
  });

  it('should provide rotation guidance for each category', () => {
    for (const [_name, category] of Object.entries(SECRET_MANIFEST)) {
      expect(category.rotation).toBeTruthy();
      expect(category.rotation.length).toBeGreaterThan(10);
    }
  });

  it('should provide generation guidance for each category', () => {
    for (const [_name, category] of Object.entries(SECRET_MANIFEST)) {
      expect(category.generation).toBeTruthy();
      expect(category.generation.length).toBeGreaterThan(5);
    }
  });
});

describe('getSecretsForFeature', () => {
  it('should return core secrets', () => {
    const vars = getSecretsForFeature('core');
    expect(vars).toContain('JWT_KEY_1');
    expect(vars).toContain('CONTROL_PLANE_DB');
  });

  it('should return auth secrets', () => {
    const vars = getSecretsForFeature('auth');
    expect(vars).toContain('CLERK_SECRET_KEY');
  });

  it('should return payment secrets', () => {
    const vars = getSecretsForFeature('payments');
    expect(vars).toContain('STRIPE_SECRET_KEY');
  });

  it('should return AI secrets', () => {
    const vars = getSecretsForFeature('ai');
    expect(vars).toContain('OPENAI_API_KEY');
  });
});

describe('getRequiredSecretCategories', () => {
  it('should return only required categories', () => {
    const required = getRequiredSecretCategories();
    expect(required).toContain('core');
    expect(required).toContain('auth');
    expect(required).toContain('payments');
    expect(required).not.toContain('email');
    expect(required).not.toContain('social');
    expect(required).not.toContain('ai');
  });
});

describe('validateSecretStrength', () => {
  it('should reject empty values', () => {
    const result = validateSecretStrength('TEST_KEY', '');
    expect(result.valid).toBe(false);
    expect(result.warning).toContain('too short');
  });

  it('should reject very short values', () => {
    const result = validateSecretStrength('TEST_KEY', 'abc');
    expect(result.valid).toBe(false);
    expect(result.warning).toContain('too short');
  });

  it('should reject repeated character patterns', () => {
    const result = validateSecretStrength('TEST_KEY', 'aaaaaaaaaa');
    expect(result.valid).toBe(false);
    expect(result.warning).toContain('repeated');
  });

  it('should reject common weak patterns', () => {
    const result = validateSecretStrength('TEST_KEY', 'password12345678');
    expect(result.valid).toBe(false);
    expect(result.warning).toContain('weak pattern');
  });

  it('should warn about low entropy', () => {
    const result = validateSecretStrength('TEST_KEY', 'abcdefghij');
    expect(result.valid).toBe(true);
    expect(result.warning).toContain('entropy');
  });

  it('should accept strong values', () => {
    const result = validateSecretStrength(
      'TEST_KEY',
      'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0'
    );
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });
});
