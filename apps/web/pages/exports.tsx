
import { getAuth } from '@clerk/nextjs/server';
import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import { AppShell } from '../components/AppShell';

// P0-SECURITY FIX: Added server-side authentication guard.
// Previously this page had no auth check, exposing financial export options
// (Revenue Ledger, Domain Transfer Package, Buyer Diligence Bundle) to
// unauthenticated users.
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const { userId } = getAuth(ctx.req);
  if (!userId) {
    return {
      redirect: { destination: '/login', permanent: false },
    };
  }
  return { props: {} };
};

export default function Exports() {
  return (
    <>
      <Head>
        <title>Exports — ACP</title>
        {/* P0-SECURITY FIX: Prevent search-engine indexing of financial export page */}
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <AppShell>
        <h1>Exports</h1>
        <ul>
          <li>Buyer Diligence Bundle</li>
          <li>Domain Transfer Package</li>
          <li>Revenue Ledger</li>
          <li>Content Inventory</li>
        </ul>
      </AppShell>
    </>
  );
}
