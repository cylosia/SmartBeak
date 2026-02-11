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

export const envConfig = {
  /** Current environment */
  nodeEnv: process.env['NODE_ENV'] || 'development',

  /** Is production environment */
  isProduction: isProduction(),

  /** Is development environment */
  isDevelopment: isDevelopment(),

  /** Is test environment */
  isTest: isTest(),

  /** Application version */
  version: process.env['APP_VERSION'] || '1.0.0',

  /** Build timestamp */
  buildTimestamp: process.env['BUILD_TIMESTAMP'] || new Date().toISOString(),

  /** Git commit SHA */
  gitCommit: process.env['GIT_COMMIT'] || 'unknown',
} as const;
