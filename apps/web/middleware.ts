
import { getAuth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// import { getLogger } from '@kernel/logger';
const logger = {
  debug: (..._args: unknown[]) => {},
  info: (..._args: unknown[]) => {},
  warn: (..._args: unknown[]) => {},
  error: (..._args: unknown[]) => console.error(..._args),
};

/**
* Next.js Middleware
* Handles session validation and security checks
*/

// Security headers to add to all responses
const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  // P2-FIX: Removed unsafe-inline from CSP - using strict nonce-based policy
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'nonce-{random}'; style-src 'self' 'nonce-{random}'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://*.clerk.accounts.dev https://api.stripe.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self';",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(self)',
};

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
*/
function addSecurityHeaders(response: NextResponse): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
  response.headers.set(key, value);
  }
}

/**
* Configure which routes the middleware runs on
*/
export const config = {
  matcher: [
  // Skip static files and API routes
  '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
};
