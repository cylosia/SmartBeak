
import { getAuth, clerkClient } from '@clerk/nextjs/server';
import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import { AppShell } from '../components/AppShell';

// P1-1 FIX: Enforce admin/owner role on the financial exports page.
// Previously only authentication was checked; any viewer or editor in any org
// could access Revenue Ledger, Domain Transfer Package, and Buyer Diligence Bundle.
const EXPORT_ALLOWED_ROLES = new Set(['org:admin', 'org:owner']);

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const { userId, orgId } = getAuth(ctx.req);
  if (!userId) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  if (!orgId) {
    return { redirect: { destination: '/select-org', permanent: false } };
  }
  try {
    const membershipList = await (await clerkClient()).organizations.getOrganizationMembershipList({
      organizationId: orgId,
      userId: [userId],
    });
    const membership = membershipList.data[0];
    if (!membership || !EXPORT_ALLOWED_ROLES.has(membership.role)) {
      return { redirect: { destination: '/unauthorized', permanent: false } };
    }
  } catch {
    return { redirect: { destination: '/unauthorized', permanent: false } };
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
