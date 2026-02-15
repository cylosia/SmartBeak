/**
 * Next.js Configuration
 *
 * Security-hardened configuration with proper headers and settings.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // Enable standalone output for Docker containerization
  output: 'standalone',

  // Security: Do not expose source maps to browsers in production.
  // Upload source maps to error-tracking services (e.g. Sentry) privately instead.
  productionBrowserSourceMaps: false,

  // Security: Disable X-Powered-By header
  poweredByHeader: false,

  // Security: Enable strict mode for React
  reactStrictMode: true,

  // SECURITY FIX (Finding 16): Use remotePatterns instead of deprecated domains config
  // F5-FIX: Use specific hostnames instead of double-glob wildcard (**) which
  // matches arbitrary subdomain depth and could allow open redirects via DNS takeover
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
      },
      {
        protocol: 'https',
        hostname: 'images.clerk.dev',
      },
      {
        protocol: 'https',
        hostname: 'files.stripe.com',
      },
    ],
  },

  // Security headers for all routes
  async headers() {
    return [
      {
        source: '/:path*',
        // Values must match packages/config/headers.ts (canonical source of truth)
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'X-XSS-Protection',
            value: '0',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          // CSP is exclusively set in middleware.ts with per-request nonce generation.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(self), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
          },
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'off',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-origin',
          },
        ],
      },
    ];
  },

  // Environment variables exposed to browser
  env: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_ACP_API: process.env.NEXT_PUBLIC_ACP_API,
  },
};

module.exports = nextConfig;
