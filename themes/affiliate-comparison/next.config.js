/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,

  // P2-FIX: Disable X-Powered-By header (information disclosure)
  poweredByHeader: false,

  // P2-MEDIUM FIX: Add security headers
  async headers() {
  return [
    {
    source: '/:path*',
    headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-XSS-Protection', value: '1; mode=block' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // P2-FIX: Added HSTS header (missing from theme configs)
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
      {
      key: 'Content-Security-Policy',
      // P2-FIX: Tightened connect-src from 'self' https: (any HTTPS) to 'self' only.
      // Themes should not make arbitrary external connections.
      value: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
      },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ],
    },
  ];
  },
};
