/**
 * Configuration Validation
 *
 * Validates required and optional environment variables at startup.
 * Uses Zod schema internally for type-safe validation while preserving
 * the existing ValidationResult API for backward compatibility.
 *
 * SECURITY FIX: Added NODE_ENV, LOG_LEVEL, and SERVICE_NAME as required.
 */

import { getEnvVar, isPlaceholder } from './env';
import { envSchema } from './schema';
import { getLogger } from '../kernel/logger';
import crypto from 'crypto';

const logger = getLogger('ConfigValidation');

// Required environment variables
// SECURITY FIX: Added NODE_ENV, LOG_LEVEL, SERVICE_NAME
export const REQUIRED_ENV_VARS = [
  'NODE_ENV',
  'LOG_LEVEL',
  'SERVICE_NAME',
  'CONTROL_PLANE_DB',
  'CLERK_SECRET_KEY',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'JWT_KEY_1',
  'JWT_KEY_2',
  // P3-6 FIX: KEY_ENCRYPTION_SECRET is critical for encrypting other secrets;
  // it must be required, not optional, in a financial-grade system
  'KEY_ENCRYPTION_SECRET',
] as const;

export type RequiredEnvVar = typeof REQUIRED_ENV_VARS[number];

// Optional environment variables
export const OPTIONAL_ENV_VARS = [
  'AHREFS_API_TOKEN',
  'GSC_CLIENT_ID',
  'GSC_CLIENT_SECRET',
  'GSC_REDIRECT_URI',
  'VERCEL_TOKEN',
  'OPENAI_API_KEY',
  'STABILITY_API_KEY',
  'REDIS_URL',
  'SLACK_WEBHOOK_URL',
  'ALERT_WEBHOOK_URL',
  'SERP_API_KEY',
  'SERP_API_PROVIDER',
  'DATAFORSEO_LOGIN',
  'DATAFORSEO_PASSWORD',
  'AMAZON_ACCESS_KEY',
  'AMAZON_SECRET_KEY',
  'AMAZON_ASSOCIATE_TAG',
  'CJ_PERSONAL_TOKEN',
  'CJ_WEBSITE_ID',
  'IMPACT_ACCOUNT_SID',
  'IMPACT_AUTH_TOKEN',
  'EMAIL_FROM',
  'EMAIL_FROM_NAME',
  'EMAIL_REPLY_TO',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_SECURE',
  'SENDGRID_API_KEY',
  'POSTMARK_SERVER_TOKEN',
  'LINKEDIN_CLIENT_ID',
  'LINKEDIN_CLIENT_SECRET',
  'GBP_CLIENT_ID',
  'GBP_CLIENT_SECRET',
  'TIKTOK_CLIENT_KEY',
  'TIKTOK_CLIENT_SECRET',
  'PORT',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_ACP_API',
  'APP_URL',
  'CDN_BASE_URL',
  'NEXT_PUBLIC_CDN_BASE_URL',
  'FORMS_BASE_URL',
  'NEXT_PUBLIC_FORMS_BASE_URL',
] as const;

export type OptionalEnvVar = typeof OPTIONAL_ENV_VARS[number];

/**
 * Check if an optional variable is commonly used
 */
function isCommonlyUsedOptional(key: OptionalEnvVar): boolean {
  const commonlyUsed: OptionalEnvVar[] = [
    'REDIS_URL',
    'OPENAI_API_KEY',
    'NEXT_PUBLIC_ACP_API',
    'NEXT_PUBLIC_APP_URL',
    'APP_URL',
  ];
  return commonlyUsed.includes(key);
}

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  missing: RequiredEnvVar[];
  placeholders: RequiredEnvVar[];
  invalid: Array<{ key: RequiredEnvVar; reason: string }>;
  warnings: string[];
}

/**
 * Validate environment configuration using Zod schema.
 *
 * Parses process.env through the Zod envSchema first, then maps any
 * schema errors into the legacy ValidationResult shape so existing
 * consumers and tests continue to work unchanged.
 *
 * SECURITY FIX: Added validation for NODE_ENV, LOG_LEVEL, SERVICE_NAME
 */
export function validateConfig(): ValidationResult {
  const missing: RequiredEnvVar[] = [];
  const placeholders: RequiredEnvVar[] = [];
  const invalid: Array<{ key: RequiredEnvVar; reason: string }> = [];
  const warnings: string[] = [];

  // --- Phase 1: Legacy presence/placeholder checks (backward compat) ---
  for (const key of REQUIRED_ENV_VARS) {
    const value = getEnvVar(key);
    if (!value) {
      missing.push(key);
    } else if (isPlaceholder(value)) {
      placeholders.push(key);
    }
  }

  // --- Phase 2: Zod schema validation for type/format checks ---
  // Only run schema validation if all required vars are present (not missing)
  // to avoid duplicate "missing" errors from Zod.
  if (missing.length === 0 && placeholders.length === 0) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const key = issue.path[0] as string;
        // Only report errors for required vars in the invalid array
        if (REQUIRED_ENV_VARS.includes(key as RequiredEnvVar)) {
          // Avoid duplicates
          if (!invalid.some(i => i.key === key)) {
            invalid.push({ key: key as RequiredEnvVar, reason: issue.message });
          }
        }
      }
    }
  }

  // --- Phase 3: Security-critical cross-field checks ---
  // P2-9 FIX: Use timing-safe comparison for JWT key equality check
  const jwtKey1 = getEnvVar('JWT_KEY_1');
  const jwtKey2 = getEnvVar('JWT_KEY_2');
  if (jwtKey1 && jwtKey2) {
    const buf1 = Buffer.from(jwtKey1);
    const buf2 = Buffer.from(jwtKey2);
    const areEqual = buf1.length === buf2.length && crypto.timingSafeEqual(buf1, buf2);
    if (areEqual) {
      // Avoid duplicate if Zod already caught this
      if (!invalid.some(i => i.key === 'JWT_KEY_2')) {
        invalid.push({ key: 'JWT_KEY_2', reason: 'JWT_KEY_1 and JWT_KEY_2 must be different values' });
      }
    }
  }

  // --- Phase 4: Optional variable warnings ---
  if (process.env['NODE_ENV'] !== 'production') {
    const missingOptional: OptionalEnvVar[] = [];
    for (const key of OPTIONAL_ENV_VARS) {
      const value = getEnvVar(key);
      if (!value && isCommonlyUsedOptional(key)) {
        missingOptional.push(key);
      }
    }

    if (missingOptional.length > 0) {
      warnings.push(
        `Optional environment variables not set: ${missingOptional.join(', ')}. ` +
        `Some features may be unavailable.`
      );
    }
  }

  return {
    valid: missing.length === 0 && placeholders.length === 0 && invalid.length === 0,
    missing,
    placeholders,
    invalid,
    warnings,
  };
}

/**
 * Validates that all required environment variables are present.
 * Call this at application startup.
 * @throws Error if required variables are missing, contain placeholders, or are invalid
 */
export function validateEnv(): void {
  const result = validateConfig();

  if (!result.valid) {
    const errors: string[] = [];

    if (result.missing.length > 0) {
      errors.push(`Missing required variables: ${result.missing.join(', ')}`);
    }
    if (result.placeholders.length > 0) {
      errors.push(`Placeholder values detected: ${result.placeholders.join(', ')}`);
    }
    if (result.invalid.length > 0) {
      for (const { key, reason } of result.invalid) {
        errors.push(`Invalid ${key}: ${reason}`);
      }
    }

    throw new Error(
      `MISSING_REQUIRED_ENV_VARS:\n${errors.join('\n')}\n\n` +
      `Please set these environment variables in your .env file or deployment platform.\n` +
      `Do not use placeholder values in production.`
    );
  }

  // Log warnings
  for (const warning of result.warnings) {
    logger.warn(warning);
  }

  // Log success
  logger.info('[Config] Environment validation passed');
}

/**
 * Startup validation that fails fast with detailed error messages
 * SECURITY FIX: Comprehensive startup validation
 */
export function validateStartup(): void {
  logger.info('[Config] Running startup validation...');

  // Run standard validation
  validateEnv();

  // Additional security validations
  const securityErrors: string[] = [];

  // Check bcrypt rounds in production
  const bcryptRounds = process.env['BCRYPT_ROUNDS'];
  if (process.env['NODE_ENV'] === 'production') {
    if (!bcryptRounds || parseInt(bcryptRounds, 10) < 10) {
      securityErrors.push('BCRYPT_ROUNDS must be at least 10 in production');
    }
  }

  // Check JWT expiry is not too long
  const jwtExpiry = process.env['JWT_EXPIRY_SECONDS'];
  if (jwtExpiry) {
    const expirySeconds = parseInt(jwtExpiry, 10);
    if (expirySeconds > 86400) { // 24 hours
      securityErrors.push('JWT_EXPIRY_SECONDS should not exceed 86400 (24 hours)');
    }
  }

  if (securityErrors.length > 0) {
    throw new Error(
      `STARTUP_VALIDATION_FAILED:\n${securityErrors.join('\n')}\n\n` +
      `Please review your security configuration.`
    );
  }

  logger.info('[Config] Startup validation passed');
}

/**
 * Gets a required environment variable
 */
export function requireEnv(key: RequiredEnvVar): string {
  const value = getEnvVar(key);
  if (!value || isPlaceholder(value)) {
    throw new Error(`Required environment variable ${key} is not set or contains placeholder value`);
  }
  return value;
}

/**
 * Gets an optional environment variable
 */
export function getOptionalEnv(key: OptionalEnvVar): string | undefined {
  const value = getEnvVar(key);
  if (isPlaceholder(value)) {
    return undefined;
  }
  return value;
}

/**
 * Gets an optional environment variable (alias for getOptionalEnv)
 */
export function getEnv(key: OptionalEnvVar): string | undefined {
  return getOptionalEnv(key);
}

/**
 * Gets an optional environment variable with a default value
 */
export function getEnvWithDefault(key: OptionalEnvVar, defaultValue: string): string {
  const value = getOptionalEnv(key);
  return value ?? defaultValue;
}
