/**
 * Security Headers Configuration
 *
 * Canonical source of truth for all HTTP security headers across the platform.
 * This module is pure (no process.env access, no side effects) so it can be
 * safely imported in Edge Runtime (Next.js middleware) and Node.js alike.
 *
 * Surfaces that consume these values:
 * - control-plane/api/http.ts          (imports directly)
 * - apps/web/middleware.ts             (imports directly)
 * - apps/web/next.config.js            (inline copy --CJS, cannot import TS)
 * - vercel.json                        (inline copy --JSON)
 * - themes/{name}/next.config.js       (inline copy --CJS, outside workspace)
 *
 * When updating values here, also update the inline copies listed above.
 *
 * @module @config/headers
 */

// ---------------------------------------------------------------------------
// Non-CSP Security Headers (shared across all surfaces)
// ---------------------------------------------------------------------------

/**
 * Baseline security headers applied to every HTTP response.
 * Does NOT include CSP or Permissions-Policy (those vary by surface).
 */
export const BASE_SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Modern recommendation: disable the XSS auditor. It was removed from all
  // browsers and enabling it can introduce XSS vulnerabilities via selective
  // script blocking.
  'X-XSS-Protection': '0',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-DNS-Prefetch-Control': 'off',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// ---------------------------------------------------------------------------
// Permissions-Policy variants
// ---------------------------------------------------------------------------

/** Permissions-Policy for the web application --allows payment on self. */
export const PERMISSIONS_POLICY_WEB_APP =
  'camera=(), microphone=(), geolocation=(), payment=(self), usb=(), magnetometer=(), gyroscope=(), accelerometer=()';

/** Permissions-Policy for the API --fully restrictive (no payment needed). */
export const PERMISSIONS_POLICY_API =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()';

/** Permissions-Policy for themes --no payment needed. */
export const PERMISSIONS_POLICY_THEMES = PERMISSIONS_POLICY_API;

// ---------------------------------------------------------------------------
// Content-Security-Policy --API (JSON-only, no HTML/JS/CSS)
// ---------------------------------------------------------------------------

/**
 * Maximally restrictive CSP for the Fastify API which serves only JSON.
 * Every resource directive is set to 'none'.
 */
export const CSP_API = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'none'",
  "img-src 'none'",
  "font-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'upgrade-insecure-requests',
].join('; ');

// ---------------------------------------------------------------------------
// Content-Security-Policy --Web App (Next.js with per-request nonce)
// ---------------------------------------------------------------------------

/**
 * Build a CSP header for the Next.js web application.
 * Uses a per-request cryptographic nonce for inline scripts and styles.
 */
export function buildWebAppCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: https://img.clerk.com https://images.clerk.dev https://files.stripe.com",
    "font-src 'self'",
    "connect-src 'self' https://*.clerk.accounts.dev https://api.stripe.com",
    "object-src 'none'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

// ---------------------------------------------------------------------------
// Content-Security-Policy --Themes (static, no nonce)
// ---------------------------------------------------------------------------

/**
 * Static CSP for theme sites. No nonce needed --themes do not use inline
 * scripts or styles.
 */
export const CSP_THEMES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');
