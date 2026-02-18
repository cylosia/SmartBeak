/**
 * Environment Validation Schema
 *
 * Zod-based schema providing type-safe validation for all environment variables.
 * Used internally by validateConfig() for fail-fast boot validation.
 *
 * @module @config/schema
 */

import { z } from 'zod';

// ============================================================================
// Reusable validators
// ============================================================================

const nonPlaceholder = z.string().min(3).refine(
  (val) => !/\bplaceholder\b|\byour_|\bxxx\b|\bexample\b|\btest\b|\bdemo\b|\bfake\b|\bmock\b|\binvalid\b|\bnull\b|^\s*$/i.test(val),
  { message: 'Value appears to be a placeholder' }
);

// P1-FIX: Minimum 32 characters for cryptographic secrets (JWT keys, encryption
// keys, webhook secrets).  10 chars ≈ 50 bits — brute-forceable.  32 random
// bytes (base64 ≈ 44 chars, hex ≈ 64 chars) provides 256 bits of entropy.
// Generate suitable values with: openssl rand -base64 48
const secretString = nonPlaceholder.pipe(z.string().min(32));

// ============================================================================
// Environment schema
// ============================================================================

export const envSchema = z.object({
  // -- Core --
  NODE_ENV: z.enum(['development', 'production', 'test']),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']),
  SERVICE_NAME: z.string().min(2).regex(/^[a-zA-Z0-9_-]+$/, {
    message: 'SERVICE_NAME must contain only alphanumeric characters, hyphens, and underscores',
  }),
  PORT: z.coerce.number().int().positive().optional(),

  // -- Database --
  CONTROL_PLANE_DB: nonPlaceholder,

  // -- Auth (Clerk) --
  CLERK_SECRET_KEY: secretString,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: secretString,
  CLERK_WEBHOOK_SECRET: secretString,

  // -- Payments --
  STRIPE_SECRET_KEY: secretString,
  STRIPE_WEBHOOK_SECRET: secretString,

  // -- Security --
  JWT_KEY_1: secretString,
  JWT_KEY_2: secretString,
  KEY_ENCRYPTION_SECRET: secretString,

  // -- Optional services --
  REDIS_URL: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(10).optional(),
  STABILITY_API_KEY: z.string().min(10).optional(),
  AHREFS_API_TOKEN: z.string().min(1).optional(),
  GSC_CLIENT_ID: z.string().min(1).optional(),
  GSC_CLIENT_SECRET: z.string().min(1).optional(),
  GSC_REDIRECT_URI: z.string().min(1).optional(),
  VERCEL_TOKEN: z.string().min(10).optional(),
  SERP_API_KEY: z.string().min(1).optional(),
  SERP_API_PROVIDER: z.enum(['serpapi', 'dataforseo', 'custom']).optional(),
  DATAFORSEO_LOGIN: z.string().min(1).optional(),
  DATAFORSEO_PASSWORD: z.string().min(1).optional(),

  // -- Affiliate --
  AMAZON_ACCESS_KEY: z.string().min(1).optional(),
  AMAZON_SECRET_KEY: z.string().min(1).optional(),
  AMAZON_ASSOCIATE_TAG: z.string().min(1).optional(),
  CJ_PERSONAL_TOKEN: z.string().min(1).optional(),
  CJ_WEBSITE_ID: z.string().min(1).optional(),
  IMPACT_ACCOUNT_SID: z.string().min(1).optional(),
  IMPACT_AUTH_TOKEN: z.string().min(1).optional(),

  // -- Email --
  EMAIL_FROM: z.string().email().optional(),
  EMAIL_FROM_NAME: z.string().min(1).optional(),
  EMAIL_REPLY_TO: z.string().email().optional(),
  SENDGRID_API_KEY: z.string().min(10).optional(),
  POSTMARK_SERVER_TOKEN: z.string().min(10).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),

  // -- Social --
  LINKEDIN_CLIENT_ID: z.string().min(1).optional(),
  LINKEDIN_CLIENT_SECRET: z.string().min(1).optional(),
  GBP_CLIENT_ID: z.string().min(1).optional(),
  GBP_CLIENT_SECRET: z.string().min(1).optional(),
  TIKTOK_CLIENT_KEY: z.string().min(1).optional(),
  TIKTOK_CLIENT_SECRET: z.string().min(1).optional(),

  // -- Monitoring --
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  ALERT_WEBHOOK_URL: z.string().url().optional(),

  // -- App URLs --
  APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_ACP_API: z.string().url().optional(),

  // -- CDN / Embed --
  CDN_BASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_CDN_BASE_URL: z.string().url().optional(),
  FORMS_BASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_FORMS_BASE_URL: z.string().url().optional(),

  // -- Security tuning --
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(31).optional(),
  JWT_EXPIRY_SECONDS: z.coerce.number().int().positive().optional(),

  // -- Feature flags --
  ENABLE_AI: z.enum(['true', 'false', '1', '0']).optional(),
  ENABLE_SOCIAL_PUBLISHING: z.enum(['true', 'false', '1', '0']).optional(),
  ENABLE_EMAIL_MARKETING: z.enum(['true', 'false', '1', '0']).optional(),
  ENABLE_ANALYTICS: z.enum(['true', 'false', '1', '0']).optional(),
  ENABLE_AFFILIATE: z.enum(['true', 'false', '1', '0']).optional(),
  ENABLE_EXPERIMENTAL: z.enum(['true', 'false', '1', '0']).optional(),
  ENABLE_CIRCUIT_BREAKER: z.enum(['true', 'false', '1', '0']).optional(),
  ENABLE_RATE_LIMITING: z.enum(['true', 'false', '1', '0']).optional(),
  NEXT_PUBLIC_ENABLE_BETA: z.enum(['true', 'false', '1', '0']).optional(),
  NEXT_PUBLIC_ENABLE_CHAT: z.enum(['true', 'false', '1', '0']).optional(),
}).refine(
  (data) => data.JWT_KEY_1 !== data.JWT_KEY_2,
  { message: 'JWT_KEY_1 and JWT_KEY_2 must be different values', path: ['JWT_KEY_2'] }
);

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Derive required keys from the schema (non-optional fields).
 */
export const SCHEMA_REQUIRED_KEYS = [
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
  'KEY_ENCRYPTION_SECRET',
] as const;
