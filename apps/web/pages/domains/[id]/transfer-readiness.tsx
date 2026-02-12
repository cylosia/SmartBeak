import type { GetServerSideProps } from 'next';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';
import { authFetch, apiUrl } from '../../../lib/api-client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TransferReadinessProps {
  domainId: string;
}

export default function TransferReadiness({ domainId }: TransferReadinessProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='buyer' />
      <h2>Transfer Readiness</h2>
      <ul>
        <li>Domain integrations scoped</li>
        <li>No org-level dependencies</li>
        <li>Revenue ledger complete</li>
        <li>Content ownership clear</li>
      </ul>
    </AppShell>
  );
}

// P1-8 FIX: Added UUID validation and auth check via authFetch
// (same pattern as parent [id].tsx page)
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const id = ctx.params?.['id'];

  // Validate UUID format to prevent malformed IDs
  if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
    return { notFound: true };
  }

  // Verify domain access via authenticated API call
  const domainRes = await authFetch(apiUrl(`domains/${id}`), { ctx });
  if (!domainRes.ok) {
    if (domainRes.status === 401) {
      return { redirect: { destination: '/login', permanent: false } };
    }
    return { notFound: true };
  }

  return { props: { domainId: id } };
};
