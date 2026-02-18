
import { getAuth } from '@clerk/nextjs/server';
import type { GetServerSideProps } from 'next';

import { AppShell } from '../../components/AppShell';

export const getServerSideProps: GetServerSideProps = async ({ req }) => {
  const { userId } = getAuth(req);
  if (!userId) {
    return { redirect: { destination: '/sign-in', permanent: false } };
  }
  return { props: {} };
};

export default function BuyerSessions() {
  return (
  <AppShell>
    <h2>Buyer Sessions</h2>
    <ul>
    <li>Buyer A — Active</li>
    <li>Buyer B — Expired</li>
    </ul>
  </AppShell>
  );
}
