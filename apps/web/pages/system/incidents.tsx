// P2-4 FIX: Added server-side auth guard. Previously this admin page had
// NO getServerSideProps at all — accessible by unauthenticated users.
import { GetServerSideProps } from 'next';

import { AppShell } from '../../components/AppShell';
import { authFetch, apiUrl } from '../../lib/api-client';

export default function SystemIncidents() {
  return (
  <AppShell>
    <h2>System Incidents</h2>
    <ul>
    <li>Webhook retry — resolved</li>
    <li>Vercel provisioning error — resolved</li>
    </ul>
  </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  // Gate on an admin-protected endpoint. The admin/* routes require
  // ['owner', 'admin'] roles (enforced server-side in guardrails.ts).
  try {
    await authFetch(apiUrl('admin/cache/stats'), { ctx });
    return { props: {} };
  } catch {
    return { redirect: { destination: '/login', permanent: false } };
  }
};
