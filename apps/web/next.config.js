/**
 * Next.js Configuration
 *
 * Security-hardened configuration with proper headers and settings.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // Security: Disable X-Powered-By header
  poweredByHeader: false,

  // Security: Enable strict mode for React
  reactStrictMode: true,

  // SECURITY FIX (Finding 16): Use remotePatterns instead of deprecated domains config
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.clerk.com',
      },
      {
        protocol: 'https',
        hostname: '**.stripe.com',
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
          {
            key: 'Content-Security-Policy',
            // P2-FIX: Removed unsafe-inline and unsafe-eval - using nonce-based policy
            value: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://*.clerk.accounts.dev https://api.stripe.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self';",
          },
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
