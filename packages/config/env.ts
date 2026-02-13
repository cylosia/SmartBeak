/**
 * Environment Variable Utilities
 *
 * Provides safe parsing and validation of environment variables.
 */

import { getLogger } from '@kernel/logger';

const logger = getLogger('config');

// P1-SECURITY FIX: Use word boundaries to prevent matching legitimate values
// containing substrings like "test" (e.g., "contest-api-key", "attestation-token")
const PLACEHOLDER_PATTERN = /\bplaceholder\b|\byour_|\bxxx\b|\bexample\b|\btest\b|\bdemo\b|\bfake\b|\bmock\b|\binvalid\b|\bnull\b|^\s*$/i;

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
  if (value.length < 3) return true;
  return PLACEHOLDER_PATTERN.test(value);
}

/**
 * Parse integer environment variable with default
 */
export function parseIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  // P2-TYPE FIX: Use Number() + Number.isInteger() instead of parseInt() to match requireIntEnv.
  // parseInt('3.14abc', 10) silently returns 3, masking invalid input.
  const parsed = Number(value);
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
  // P1-TYPE FIX: Use Number() + Number.isInteger() instead of parseInt()
  // parseInt('3.14') silently returns 3, but we want to reject floats
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid integer`);
  }
  return parsed;
}

/**
 * Parse float environment variable with default
 */
export function parseFloatEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
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
  const normalized = value.toLowerCase();
  if (normalized === 'true' || value === '1') return true;
  if (normalized === 'false' || value === '0') return false;
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
