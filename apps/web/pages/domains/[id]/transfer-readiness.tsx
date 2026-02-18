import type { GetServerSidePropsContext } from 'next';
import { getAuth } from '@clerk/nextjs/server';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';
import { query } from '@database/transactions';

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
// SECURITY FIX TR-2: Added domain ownership check — authenticated users cannot enumerate
// other organizations' domain IDs (IDOR vulnerability).
export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }

  const { userId, orgId } = getAuth(req);
  if (!userId) {
    return { redirect: { destination: '/login', permanent: false } };
  }

  // Verify the domain belongs to the user's organization to prevent IDOR.
  // Return 404 (not 403) to prevent domain ID enumeration.
  if (orgId) {
    try {
      const result = await query(
        'SELECT 1 FROM domains WHERE id = $1 AND org_id = $2',
        [id, orgId]
      );
      if (result.rows.length === 0) {
        return { notFound: true };
      }
    } catch {
      // On DB error, deny access rather than exposing the page
      return { notFound: true };
    }
  }

  return { props: { domainId: id } };
}
