// AUDIT-FIX M21: Added client-side route protection via useAuth hook.
// Previously only server-side check existed; client-side navigation could bypass it.
import { GetServerSideProps } from 'next';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

import { AppShell } from '../../components/AppShell';
import { authFetch, apiUrl } from '../../lib/api-client';

// AUDIT-FIX M23: Define expected response shape instead of trusting any 200.
interface CacheStatsResponse {
  /** Any truthy stats object confirms admin access */
  hitRate?: number;
  memoryUsage?: number;
}

export default function SystemJobs() {
  // AUDIT-FIX M21: Client-side auth guard redirects unauthenticated users.
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      void router.replace('/login');
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

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  // AUDIT-FIX H11: Validate the response body against an expected schema
  // instead of treating any HTTP success as authorization. A CDN/proxy
  // returning 200 for all requests would previously grant unauthorized access.
  //
  // AUDIT-FIX P2: Redirect non-admin authenticated users to dashboard (/)
  // instead of /login. Redirecting to /login creates a redirect loop for
  // authenticated non-admin users (Clerk sees them as signed in and bounces
  // them back). Use /login only for unauthenticated users (401).
  try {
    const response = await authFetch(apiUrl('admin/cache/stats'), { ctx });
    // AUDIT-FIX P2: Check response.ok before parsing JSON. Non-2xx responses
    // (e.g. 502 from reverse proxy) may return HTML, causing .json() to throw
    // with an unhelpful "Unexpected token <" error instead of redirecting.
    if (!response.ok) {
      // 401 = not authenticated → /login; 403 = not authorized → /
      const destination = response.status === 401 ? '/login' : '/';
      return { redirect: { destination, permanent: false } };
    }
    const data = await response.json() as CacheStatsResponse;

    // Validate the response contains expected admin-only data structure
    if (typeof data !== 'object' || data === null || !('hitRate' in data || 'memoryUsage' in data)) {
      return { redirect: { destination: '/', permanent: false } };
    }

    return { props: {} };
  } catch {
    return { redirect: { destination: '/login', permanent: false } };
  }
};
