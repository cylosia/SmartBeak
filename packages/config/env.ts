/**
 * Environment Variable Utilities
 *
 * Provides safe parsing and validation of environment variables.
 */

import { getLogger } from '@kernel/logger';

const logger = getLogger('config');

// P1-7 FIX: Replace `\btest\b` with `^test$`.
// `\btest\b` matched Stripe test-mode keys (sk_test_*) because `_` is a word-boundary
// character — `isPlaceholder('sk_test_abc')` incorrectly returned true, refusing startup
// in staging environments. `^test$` only matches when the entire value is the word "test".
const PLACEHOLDER_PATTERN = /\bplaceholder\b|\byour_|\bxxx\b|\bexample\b|^test$|\bdemo\b|\bfake\b|\bmock\b|\binvalid\b|\bnull\b|^\s*$/i;

/**
 * Get environment variable value
 */
export function getEnvVar(name: string): string | undefined {
  return process.env[name];
}

/**
 * Check if a value is a placeholder
 */
export function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  // P1-FIX: Trim before length check. Without trim, ' a' (2 chars: space + a) would
  // be flagged as a placeholder (length < 3) even though the actual content 'a' is
  // the issue, not the whitespace. Also ensures regex tests the actual content,
  // consistent with parseIntEnv which also trims before evaluation.
  const trimmed = value.trim();
  if (trimmed.length < 3) return true;
  return PLACEHOLDER_PATTERN.test(trimmed);
}

/**
 * Parse integer environment variable with default
 */
export function parseIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  // P3-3 FIX: Trim before parsing — Number('  ') === 0, which is a valid integer,
  // so a whitespace-only value would previously return 0 instead of the default.
  // Example: PORT='  ' → parseIntEnv('PORT', 3001) returned 0, binding to a random port.
  const trimmed = value.trim();
  if (!trimmed) return defaultValue;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : defaultValue;
}

/**
 * SECURITY FIX: P1-HIGH - Require integer environment variable without silent defaults
 * For security-critical configs, fail fast instead of using defaults
 * @throws Error when environment variable is not set or invalid
 */
export function requireIntEnv(name: string): number {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  // P1-FIX: Trim whitespace before parsing, consistent with parseIntEnv.
  // Without trim, requireIntEnv('PORT') with PORT='   ' passes the !value check
  // (whitespace-only strings are truthy), then Number('   ') === 0, and
  // Number.isInteger(0) === true — silently returning 0. For security-critical
  // configs this is dangerous: RATE_LIMIT_MAX='  ' would set the limit to 0.
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Required environment variable ${name} is set but empty`);
  }
  // P1-TYPE FIX: Use Number() + Number.isInteger() instead of parseInt()
  // parseInt('3.14') silently returns 3, but we want to reject floats
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid integer, got: ${trimmed}`);
  }
  return parsed;
}

/**
 * Parse float environment variable with default
 */
export function parseFloatEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  // P3-FIX: Trim whitespace before parsing, consistent with parseIntEnv.
  // parseFloat('  3.14  ') returns 3.14 (lenient), but ' 0 ' would silently return 0
  // instead of the default in edge cases. Explicit trim makes behavior predictable.
  const trimmed = value.trim();
  if (!trimmed) return defaultValue;
  const parsed = parseFloat(trimmed);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse boolean environment variable with default
 * SECURITY FIX: Default to false for security-critical feature flags
 */
export function parseBoolEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (!value) return defaultValue;
  // P1-SECURITY FIX: Only recognize explicit true/false values.
  // Previously, ANY non-"true"/non-"1" string (including typos like "ture", "yes", "on")
  // silently returned false, potentially disabling security features.
  // P3-FIX: Trim and normalize before comparison so '  true  ' and ' 1 ' are
  // treated consistently. Previously `value === '1'` compared the raw untrimmed
  // value while `normalized === 'true'` used the lowercased version — inconsistent.
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  logger.warn('Unrecognized boolean value, using default', { name, value, defaultValue });
  return defaultValue;
}

/**
 * SECURITY FIX: P1-CRITICAL - Require boolean environment variable without silent defaults
 * For security-critical feature flags, fail fast instead of using defaults
 * @throws Error when environment variable is not set or invalid
 */
export function requireBoolEnv(name: string): boolean {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  const normalized = value.toLowerCase();
  if (normalized !== 'true' && normalized !== 'false' && value !== '1' && value !== '0') {
    throw new Error(`Environment variable ${name} must be 'true', 'false', '1', or '0'`);
  }
  return normalized === 'true' || value === '1';
}

/**
 * Parse string array environment variable with default
 */
export function parseArrayEnv(name: string, separator = ','): string[] {
  const value = process.env[name];
  if (!value) return [];
  return value.split(separator).map(s => s.trim()).filter(Boolean);
}

/**
 * Parse JSON environment variable with default
 */
export function parseJSONEnv<T>(name: string, defaultValue: T): T {
  const value = process.env[name];
  if (!value) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch (e) {
    // P2-SECURITY FIX: Log a warning when JSON parsing fails instead of silently returning default.
    // For security-critical configs, silent failures can mask misconfiguration.
    const errMsg = e instanceof Error ? e.message : String(e);
    logger.warn('Failed to parse JSON env var, using default', { name, error: errMsg });
    return defaultValue;
  }
}
