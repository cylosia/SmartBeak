/**
 * Environment Configuration
 * 
 * Environment detection and related settings.
 */

export function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

export function isDevelopment(): boolean {
  return process.env['NODE_ENV'] === 'development';
}

export function isTest(): boolean {
  return process.env['NODE_ENV'] === 'test';
}

// P1-ARCHITECTURE FIX: Use getter properties instead of eagerly-evaluated snapshot.
// Previously, isProduction/isDevelopment/isTest were computed once at module load
// and became stale if NODE_ENV changed (e.g., between test suites).
export const envConfig = {
  // P0-SECURITY FIX: Default to 'production' when NODE_ENV is unset.
  // Previously defaulted to 'development', which disables security controls
  // (CSP, detailed error suppression, secure cookies) in misconfigured deployments.
  /** Current environment */
  get nodeEnv() { return process.env['NODE_ENV'] || 'production'; },

  /** Is production environment */
  get isProduction() { return isProduction(); },

  /** Is development environment */
  get isDevelopment() { return isDevelopment(); },

  /** Is test environment */
  get isTest() { return isTest(); },

  /** Application version */
  get version() { return process.env['APP_VERSION'] || '1.0.0'; },

  /** Build timestamp */
  get buildTimestamp() { return process.env['BUILD_TIMESTAMP'] || new Date().toISOString(); },

  /** Git commit SHA */
  get gitCommit() { return process.env['GIT_COMMIT'] || 'unknown'; },
} as const;
