
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { BASE_SECURITY_HEADERS, buildWebAppCsp, PERMISSIONS_POLICY_WEB_APP } from '@config/headers';

// P2-11 FIX: Edge-compatible logger with PII redaction
const REDACT_KEYS = new Set(['token', 'password', 'secret', 'apikey', 'authorization', 'cookie', 'sessiontoken']);

// FIX(P2): Recursive sanitization — previously only redacted top-level keys,
// allowing nested PII (e.g. { user: { password: '...' } }) to leak through.
function sanitizeArg(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Error) return { message: obj.message, name: obj.name };
  if (Array.isArray(obj)) return obj.map(sanitizeArg);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACT_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeArg(value);
    }
  }
  return result;
}

const logger = {
  debug: (msg: string, ...args: unknown[]) => console.debug(JSON.stringify({ level: 'debug', service: 'middleware', msg, args: args.length > 0 ? args.map(sanitizeArg) : undefined, ts: Date.now() })),
  info: (msg: string, ...args: unknown[]) => console.info(JSON.stringify({ level: 'info', service: 'middleware', msg, args: args.length > 0 ? args.map(sanitizeArg) : undefined, ts: Date.now() })),
  warn: (msg: string, ...args: unknown[]) => console.warn(JSON.stringify({ level: 'warn', service: 'middleware', msg, args: args.length > 0 ? args.map(sanitizeArg) : undefined, ts: Date.now() })),
  error: (msg: string, ...args: unknown[]) => console.error(JSON.stringify({ level: 'error', service: 'middleware', msg, args: args.length > 0 ? args.map(sanitizeArg) : undefined, ts: Date.now() })),
};

/**
* Next.js Middleware
* P0-5 FIX: Use clerkMiddleware() instead of manual getAuth() pattern.
* Clerk v6 requires clerkMiddleware to process the request before auth is available.
* P1-11 FIX: Use hardcoded origin instead of req.url to prevent open redirect via Host header.
* P2-14 FIX: Propagate CSP nonce via request headers for server components.
* P2-15 FIX: Add Vary header to prevent CDN caching of per-request CSP nonces.
* P2-16 FIX: Add CSRF origin validation for state-changing requests.
* P2-17 FIX: Removed hardcoded cookie name; Clerk handles cookie names internally.
*/

const STATIC_SECURITY_HEADERS: Record<string, string> = {
  ...BASE_SECURITY_HEADERS,
  'Permissions-Policy': PERMISSIONS_POLICY_WEB_APP,
};

function generateCspNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

// P1-11 FIX: Hardcode origin to prevent open redirect via Host header injection
function getAppOrigin(): string {
  return process.env['NEXT_PUBLIC_APP_URL'] || 'https://app.smartbeak.com';
}

// P0-5 FIX: Define protected routes that require authentication
const isProtectedRoute = createRouteMatcher(['/dashboard(.*)', '/settings(.*)', '/admin(.*)']);

// P2-16 FIX: CSRF origin validation for state-changing requests
function validateOrigin(req: NextRequest): boolean {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }
  const origin = req.headers.get('origin');
  const appOrigin = getAppOrigin();
  if (!origin) {
    const referer = req.headers.get('referer');
    if (!referer) return false;
    try {
      const refererUrl = new URL(referer);
      const appUrl = new URL(appOrigin);
      return refererUrl.host === appUrl.host;
    } catch {
      return false;
    }
  }
  try {
    const originUrl = new URL(origin);
    const appUrl = new URL(appOrigin);
    return originUrl.host === appUrl.host;
  } catch {
    return false;
  }
}

// P0-5 FIX: Use clerkMiddleware - the official Clerk v6 pattern
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- types inferred from @clerk/nextjs/server
export default clerkMiddleware(async (auth: any, req: any) => {
  // P2-16 FIX: CSRF validation for state-changing requests
  if (!validateOrigin(req)) {
    logger.warn('CSRF origin validation failed', { method: req.method, url: req.url });
    return new NextResponse('Forbidden', { status: 403 });
  }

  // FIX(P2): Generate nonce at the top of the handler so it can be shared
  // with ALL response paths (redirect and pass-through) and propagated to
  // both the request headers (for server components via x-nonce) and the
  // response CSP header. Previously generated inside addSecurityHeaders,
  // preventing propagation to the request.
  const nonce = generateCspNonce();

  // Propagate nonce to request headers so Next.js server components can read it
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);

  // Protect routes that require authentication
  if (isProtectedRoute(req)) {
    try {
      await auth.protect();
    } catch {
      // P1-11 FIX: Redirect to hardcoded origin, not req.url
      const loginUrl = new URL('/login', getAppOrigin());
      const response = NextResponse.redirect(loginUrl);
      addSecurityHeaders(response, nonce);
      return response;
    }
  }

  // Add security headers to response, passing the request nonce through
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  addSecurityHeaders(response, nonce);
  return response;
});

/**
* Add security headers to response
* P1-AUDIT-FIX: Replaced Vary: Cookie with Cache-Control: no-store.
* The previous Vary: Cookie was insufficient to prevent CDN caching of
* per-request CSP nonces. Vary: Cookie creates separate cache entries
* per distinct cookie value, but nonces are per-REQUEST — two requests
* from the same user (same cookies) still get different nonces, so a
* CDN caching by cookie would serve a stale nonce on the second request,
* causing the browser to reject all inline scripts (CSP nonce mismatch).
* Cache-Control: no-store instructs all caches (CDN, browser) not to
* store this response, ensuring each request generates a fresh nonce.
* FIX(P2): Accept nonce as a parameter — nonce is now generated once at the
* middleware level and shared with both the request (x-nonce) and the response
* CSP, so server components and the browser CSP use the same value.
*/
function addSecurityHeaders(response: NextResponse, nonce: string): void {
  for (const [key, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  response.headers.set('Content-Security-Policy', buildWebAppCsp(nonce));
  // P1-AUDIT-FIX: no-store prevents CDN/proxy from caching per-request nonces.
  // Stale nonces in a cached response cause CSP to block all inline scripts.
  response.headers.set('Cache-Control', 'no-store');
}

/**
* Configure which routes the middleware runs on
*/
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
