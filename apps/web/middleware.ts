
import { getAuth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { BASE_SECURITY_HEADERS, buildWebAppCsp, PERMISSIONS_POLICY_WEB_APP } from '@config/headers';

// F3-FIX: Restore real logging. The no-op logger silently dropped all auth
// security events (session invalidation, redirects, auth failures).
// Edge Runtime cannot use Node.js-only loggers, so we use console with
// structured JSON output that Vercel's log ingestion can parse.
// P3-4 FIX: Include ...args in structured JSON output (were silently dropped)
const logger = {
  debug: (msg: string, ...args: unknown[]) => console.debug(JSON.stringify({ level: 'debug', service: 'middleware', msg, args: args.length > 0 ? args : undefined, ts: Date.now() })),
  info: (msg: string, ...args: unknown[]) => console.info(JSON.stringify({ level: 'info', service: 'middleware', msg, args: args.length > 0 ? args : undefined, ts: Date.now() })),
  warn: (msg: string, ...args: unknown[]) => console.warn(JSON.stringify({ level: 'warn', service: 'middleware', msg, args: args.length > 0 ? args : undefined, ts: Date.now() })),
  error: (msg: string, ...args: unknown[]) => console.error(JSON.stringify({ level: 'error', service: 'middleware', msg, args: args.length > 0 ? args : undefined, ts: Date.now() })),
};

/**
* Next.js Middleware
* Handles session validation and security checks
*/

// SECURITY FIX: P0-CRITICAL (Finding 2) - Static security headers (CSP generated per-request with real nonce)
// Values sourced from packages/config/headers.ts (canonical source of truth)
const STATIC_SECURITY_HEADERS: Record<string, string> = {
  ...BASE_SECURITY_HEADERS,
  'Permissions-Policy': PERMISSIONS_POLICY_WEB_APP,
};

/**
* Generate a cryptographic nonce for CSP headers
* SECURITY FIX: P0-CRITICAL - Replace static {random} placeholder with real per-request nonce
*/
function generateCspNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

export async function middleware(req: NextRequest) {
  const hasSession = req.cookies.get('__session');

  // If no session cookie, allow request (will be handled by page-level auth)
  if (!hasSession) {
  const response = NextResponse.next();
  addSecurityHeaders(response);
  return response;
  }

  try {
  // Validate session with Clerk
  let auth;
  try {
    auth = getAuth(req);
  } catch (error) {
    logger.error('Clerk auth error', error instanceof Error ? error : new Error(String(error)));
    // Clear invalid session and redirect to login
    const response = NextResponse.redirect(new URL('/login', req.url));
    // SECURITY FIX: P1-HIGH - Add secure cookie flags when clearing session
    response.cookies.set('__session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/'
    });
    addSecurityHeaders(response);
    return response;
  }

  // If session exists but is invalid/expired, clear it and redirect to login
  if (!auth.userId) {
    const response = NextResponse.redirect(new URL('/login', req.url));
    // SECURITY FIX: P1-HIGH - Add secure cookie flags when clearing session
    response.cookies.set('__session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/'
    });
    addSecurityHeaders(response);
    return response;
  }

  // Session is valid - add security headers
  const response = NextResponse.next();
  addSecurityHeaders(response);

  return response;
  } catch (error) {
  logger.error('Session validation error', error instanceof Error ? error : new Error(String(error)));

  // On error, redirect to login for safety
  const response = NextResponse.redirect(new URL('/login', req.url));
  // SECURITY FIX: P1-HIGH - Add secure cookie flags when clearing session
  response.cookies.set('__session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/'
  });
  addSecurityHeaders(response);
  return response;
  }
}

/**
* Add security headers to response
* SECURITY FIX: P0 (Finding 2) - Generate real CSP nonce per request
* SECURITY FIX: P1 (Finding 9) - Applied to all routes including API
*/
function addSecurityHeaders(response: NextResponse): void {
  for (const [key, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
  response.headers.set(key, value);
  }
  // Generate a fresh nonce for each request
  const nonce = generateCspNonce();
  response.headers.set('Content-Security-Policy', buildWebAppCsp(nonce));
  // P1-7 FIX: Do NOT expose nonce in response headers. The CSP nonce must only be
  // available server-side. In Next.js middleware, response headers are visible to
  // CDNs, proxies, and browser extensions. The nonce is already embedded in the
  // CSP header's script-src/style-src directives above, which is sufficient for
  // the browser to validate inline scripts. Server Components that need the nonce
  // should read it from the CSP header itself or use next/headers.
}

/**
* Configure which routes the middleware runs on
* SECURITY FIX: P1-HIGH (Finding 9) - Include API routes for security headers
*/
export const config = {
  matcher: [
  // Apply to all routes except static files
  '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
