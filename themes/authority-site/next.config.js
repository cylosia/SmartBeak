/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,

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
      {
      key: 'Content-Security-Policy',
      // P2-FIX: Removed unsafe-inline and unsafe-eval
      value: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
      },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ],
    },
  ];
  },
};
