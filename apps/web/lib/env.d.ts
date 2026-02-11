/**
 * Type declarations for env.js module
 */

export function validateEnv(): void;
export function requireEnv(key: string): string;
export function getEnv(key: string): string | undefined;
export function getEnvWithDefault(key: string, defaultValue: string): string;
export function isProduction(): boolean;
export function isDevelopment(): boolean;

export const REQUIRED_ENV_VARS: string[];
export const OPTIONAL_ENV_VARS: string[];
