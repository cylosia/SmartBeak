// P2-7 FIX: Added server-side auth guard. Previously this admin page was
// accessible without any authentication check.
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
    // Verify auth by making an authenticated request; redirects to login if unauthorized
    await authFetch(apiUrl('system/health'), { ctx });
    return { props: {} };
  } catch {
    return { redirect: { destination: '/login', permanent: false } };
  }
};
