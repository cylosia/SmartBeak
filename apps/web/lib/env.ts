/**
 * Environment Variable Utilities
 *
 * Provides a simple requireEnv helper for the web app.
 * Re-exports from the shared @config package where the env var
 * is part of the known RequiredEnvVar set; otherwise provides
 * a standalone implementation that accepts any variable name.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}
