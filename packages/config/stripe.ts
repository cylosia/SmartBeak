/**
 * I3: Shared Stripe Configuration
 *
 * Centralizes Stripe API version and configuration to prevent inconsistencies
 * across webhook handlers, billing routes, and API clients.
 */

/**
 * Pinned Stripe API version used across the application.
 * All Stripe clients, webhook handlers, and billing routes must use this version.
 * Update this constant when upgrading Stripe API versions.
 */
export const STRIPE_API_VERSION = '2023-10-16' as const;

/**
 * Whether to enforce strict API version checking on incoming webhooks.
 * When enabled, webhooks with mismatched api_version will be rejected.
 * Configurable via STRIPE_STRICT_API_VERSION environment variable.
 */
export const STRIPE_STRICT_API_VERSION = process.env['STRIPE_STRICT_API_VERSION'] === 'true';
