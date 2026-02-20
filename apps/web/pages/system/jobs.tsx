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
  // P2-4 FIX: Gate on the admin-protected `admin/cache/stats` endpoint instead
  // of the public `system/health` check. The admin/* routes require
  // ['owner', 'admin'] roles (enforced server-side in guardrails.ts).
  // Previously ANY authenticated user (viewer, editor) could access this page.
  try {
    await authFetch(apiUrl('admin/cache/stats'), { ctx });
    return { props: {} };
  } catch {
    return { redirect: { destination: '/login', permanent: false } };
  }
};
