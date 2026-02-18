import type { GetServerSidePropsContext } from 'next';
import { getAuth } from '@clerk/nextjs/server';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';

interface TransferReadinessProps {
  domainId: string;
}

export default function TransferReadiness({ domainId }: TransferReadinessProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='buyer' />
      <h2>Transfer Readiness</h2>
      {/* TODO: Replace with real API checks from GET /api/domains/[id]/transfer-readiness
          Static checklist was removed (TR-3) — it showed every domain as transfer-ready
          regardless of actual state, which could mislead buyers in financial transactions. */}
      <p>Checking readiness conditions for domain {domainId}…</p>
    </AppShell>
  );
}

// SECURITY FIX TR-1: Added authentication — previously any unauthenticated user could
// access this page for any domain ID (information leakage + IDOR surface).
export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return { redirect: { destination: '/login', permanent: false } };
  }

  return { props: { domainId: id } };
}
