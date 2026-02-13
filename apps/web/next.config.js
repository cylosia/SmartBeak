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

  // Enable source maps in production browser builds for debugging
  productionBrowserSourceMaps: true,

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
            value: '1; mode=block',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          // F1-FIX: CSP header REMOVED from next.config.js
          // CSP is exclusively set in middleware.ts with per-request nonce generation.
          // Having CSP in both locations caused the static CSP here to override
          // the nonce-based CSP from middleware, breaking inline scripts or defeating CSP.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(self)',
          },
        ],
      },
    ];
  },

  // SECURITY FIX: P1-HIGH Issue 5 - CORS Configuration
  async rewrites() {
    return [];
  },

  // Environment variables exposed to browser
  env: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_ACP_API: process.env.NEXT_PUBLIC_ACP_API,
  },

  // Webpack configuration if needed
  webpack: (config, { isServer }) => {
    // Custom webpack config
    return config;
  },
};

module.exports = nextConfig;
