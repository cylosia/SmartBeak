// AUDIT-FIX M21: Added client-side route protection via useAuth hook.
// Previously only server-side check existed; client-side navigation could bypass it.
import { GetServerSideProps } from 'next';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

import { AppShell } from '../../components/AppShell';
import { apiUrl } from '../../lib/api-client';

// AUDIT-FIX M23: Define expected response shape instead of trusting any 200.
interface CacheStatsResponse {
  /** Any truthy stats object confirms admin access */
  hitRate?: number;
  memoryUsage?: number;
}

// AUDIT-FIX P3: Use Clerk's standard sign-in path instead of hardcoded '/login'.
// Clerk's default sign-in route is /sign-in. Hardcoding /login causes a 404
// or redirect loop if Clerk middleware doesn't have a matching path.
const SIGN_IN_PATH = '/sign-in';

export default function SystemJobs() {
  // AUDIT-FIX M21: Client-side auth guard redirects unauthenticated users.
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      void router.replace(SIGN_IN_PATH);
    }
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded || !isSignedIn) {
    return null;
  }

  // AUDIT-FIX M23: Removed hardcoded static job data. This is a placeholder
  // for the live job monitoring dashboard.
  return (
  <AppShell>
    <h2>Background Jobs</h2>
    <p>Job monitoring dashboard — connect to live data via the admin API.</p>
  </AppShell>
  );
}

// AUDIT-FIX P1: SSR timeout for the admin probe. authFetch delegates to
// fetchWithRetry which performs 3 retries with exponential backoff (up to ~47s).
// SSR must respond quickly; a single attempt with a short timeout is appropriate.
const SSR_PROBE_TIMEOUT_MS = 3000;

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  // AUDIT-FIX H11: Validate the response body against an expected schema
  // instead of treating any HTTP success as authorization. A CDN/proxy
  // returning 200 for all requests would previously grant unauthorized access.
  //
  // AUDIT-FIX P1: Use plain fetch with AbortSignal.timeout instead of authFetch.
  // authFetch throws on non-2xx responses (making the response.ok differentiation
  // dead code) and delegates to fetchWithRetry (blocking SSR with retries).
  // A single fetch with a short timeout gives us direct status code access
  // and fails fast for SSR.
  //
  // NOTE: This is a GET request — CSRF protection is not needed per OWASP
  // guidelines (state-changing requests only). Do not copy this pattern
  // for POST/PUT/DELETE endpoints.
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SSR_PROBE_TIMEOUT_MS);

    // Forward cookies from SSR context for authenticated server-side requests
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ctx.req.headers.cookie) {
      headers['Cookie'] = ctx.req.headers.cookie;
    }

    let response: Response;
    try {
      response = await fetch(apiUrl('admin/cache/stats'), {
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // AUDIT-FIX P1: Status-based redirects now reachable (authFetch previously
    // threw before this code could execute).
    // 401 = not authenticated → sign-in; 403+ = not authorized → dashboard
    if (!response.ok) {
      const destination = response.status === 401 ? SIGN_IN_PATH : '/';
      return { redirect: { destination, permanent: false } };
    }

    // AUDIT-FIX P3: Use `unknown` instead of `as CacheStatsResponse` to avoid
    // type assertion before runtime validation. The subsequent typeof checks
    // handle validation, but the `as` cast is misleading — it implies the data
    // is already validated when it isn't.
    const data: unknown = await response.json();

    // AUDIT-FIX P2: Use typeof checks instead of `in` operator. The `in`
    // operator only checks key existence, not value type — `{"hitRate": null}`
    // or `{"hitRate": "not-a-number"}` would pass the previous check.
    if (
      typeof data !== 'object' ||
      data === null ||
      (typeof (data as Record<string, unknown>)['hitRate'] !== 'number' && typeof (data as Record<string, unknown>)['memoryUsage'] !== 'number')
    ) {
      return { redirect: { destination: '/', permanent: false } };
    }

    return { props: {} };
  } catch (err: unknown) {
    // AUDIT-FIX P3: Distinguish abort/timeout errors from auth errors.
    // A legitimate admin experiencing a slow API response (>3s) was previously
    // redirected to sign-in, creating confusing UX where the page "works" when
    // the API is fast but "requires login" when the API is slow.
    if (err instanceof Error && err.name === 'AbortError') {
      // Timeout → redirect to home with implicit "try again" rather than sign-in
      return { redirect: { destination: '/', permanent: false } };
    }
    // Parse failure or other network error → redirect to sign-in
    return { redirect: { destination: SIGN_IN_PATH, permanent: false } };
  }
};
