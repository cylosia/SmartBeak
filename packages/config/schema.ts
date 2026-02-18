/**
 * Environment Validation Schema
 *
 * Zod-based schema providing type-safe validation for all environment variables.
 * Used internally by validateConfig() for fail-fast boot validation.
 *
 * @module @config/schema
 */

import { z } from 'zod';
import { timingSafeEqual } from 'crypto';

// ============================================================================
// Reusable validators
// ============================================================================

const nonPlaceholder = z.string().min(3).refine(
  (val) => !/\bplaceholder\b|\byour_|\bxxx\b|\bexample\b|\btest\b|\bdemo\b|\bfake\b|\bmock\b|\binvalid\b|\bnull\b|^\s*$/i.test(val),
  { message: 'Value appears to be a placeholder' }
);

const secretString = nonPlaceholder.pipe(z.string().min(10));

// P0-SECURITY FIX: JWT signing keys require at minimum 32 bytes (256 bits) of entropy
// to meet NIST SP 800-132 minimums for HS256. The generic secretString allows min(10)
// which is catastrophically weak for HMAC signing keys.
const jwtKey = nonPlaceholder.pipe(z.string().min(32, {
  message: 'JWT signing key must be at least 32 characters (256 bits) for HS256',
}));

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
  // P0-SECURITY FIX: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is a *public* key — it starts with
  // "pk_" and is intentionally embedded in client bundles. Validating it as `secretString`
  // (a) gives false confidence that it's secret, and (b) blocks legitimate pk_ values
  // that start with recognisable prefixes. Use a weaker non-placeholder validator.
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: nonPlaceholder,
  CLERK_WEBHOOK_SECRET: secretString,

  // -- Payments --
  STRIPE_SECRET_KEY: secretString,
  STRIPE_WEBHOOK_SECRET: secretString,

  // -- Security --
  // P0-SECURITY FIX: Use jwtKey validator (min 32 chars) instead of secretString (min 10).
  JWT_KEY_1: jwtKey,
  JWT_KEY_2: jwtKey,
  KEY_ENCRYPTION_SECRET: jwtKey,

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
  (data) => {
    // P2-FIX: The previous implementation had an early return `if (a.length !== b.length)`
    // that leaked JWT key length information to a timing attacker — an attacker measuring
    // response time during config validation could determine whether the two keys have
    // the same length, narrowing the brute-force space. While this runs at startup and
    // is hard to exploit in practice, defensive coding should never leak via early exit.
    // Fix: pad both buffers to equal length so timingSafeEqual always executes in O(n).
    // A key whose length differs from the other will always produce an unequal comparison
    // after padding (the padding bytes are zero on one side and non-zero on the other),
    // which is semantically correct — different-length keys are definitely not equal.
    const a = Buffer.from(data.JWT_KEY_1, 'utf8');
    const b = Buffer.from(data.JWT_KEY_2, 'utf8');
    const maxLen = Math.max(a.length, b.length);
    const paddedA = Buffer.alloc(maxLen);
    const paddedB = Buffer.alloc(maxLen);
    a.copy(paddedA);
    b.copy(paddedB);
    return !timingSafeEqual(paddedA, paddedB);
  },
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
