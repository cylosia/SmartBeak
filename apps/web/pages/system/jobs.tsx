// P2-7 FIX: Added server-side auth guard. Previously this admin page was
// accessible without any authentication check.
// P1-6 AUDIT FIX: Added role-based access control. Previously any authenticated
// user (including viewers) could access this admin page.
import { GetServerSideProps } from 'next';

import { AppShell } from '../../components/AppShell';
import { authFetch, apiUrl } from '../../lib/api-client';

export default function SystemJobs() {
  return (
  <AppShell>
    <h2>Background Jobs</h2>
    <ul>
    <li>Keyword ingestion — completed</li>
    <li>Link check — running</li>
    </ul>
  </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  try {
    // P1-6 AUDIT FIX: Use the admin-only system/admin endpoint instead of the
    // public health endpoint. This ensures only admin/owner roles can access this
    // page. The previous health endpoint allowed any authenticated user through.
    const response = await authFetch(apiUrl('system/admin/jobs'), { ctx });
    if (!response.ok) {
      return { redirect: { destination: '/', permanent: false } };
    }
    return { props: {} };
  } catch {
    return { redirect: { destination: '/login', permanent: false } };
  }
};
