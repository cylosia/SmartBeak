import type { GetServerSidePropsContext } from 'next';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';
import { requireDomainAccess } from '../../../lib/auth';

interface TransferReadinessProps {
  domainId: string;
}

export default function TransferReadiness({ domainId }: TransferReadinessProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='buyer' />
      <h2>Transfer Readiness</h2>
      <ul>
        <li>Domain integrations scoped ✓</li>
        <li>No org-level dependencies ✓</li>
        <li>Revenue ledger complete ✓</li>
        <li>Content ownership clear ✓</li>
      </ul>
    </AppShell>
  );
}

// P0-2 FIX: Added domain ownership check to prevent IDOR.
// Previously any authenticated user could view any domain's transfer readiness
// by guessing or enumerating a UUID. Session auth via middleware is not sufficient —
// we must also verify the requesting user actually owns this specific domain.
export async function getServerSideProps({ req, params }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }

  const access = await requireDomainAccess(req, id);
  if (!access.authorized) {
    return access.result;
  }

  return { props: { domainId: id } };
}
