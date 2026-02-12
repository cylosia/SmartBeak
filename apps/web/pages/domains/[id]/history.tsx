import type { GetServerSidePropsContext } from 'next';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';

interface DomainHistoryProps {
  domainId: string;
}

// P1-AUDIT-FIX: Replaced hardcoded mock data with explicit placeholder.
// Previous version displayed fabricated history events that users could mistake for real data.
export default function DomainHistory({ domainId }: DomainHistoryProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='history' />
      <h2>Domain History</h2>
      <p style={{ color: '#666', fontStyle: 'italic' }}>
        History for this domain is not yet available. This feature is under development.
      </p>
    </AppShell>
  );
}

export async function getServerSideProps({ params }: GetServerSidePropsContext) {
  const id = params?.['id'];
  // P2-AUDIT-FIX: Validate domainId format (UUID)
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { notFound: true };
  }
  return { props: { domainId: id } };
}
