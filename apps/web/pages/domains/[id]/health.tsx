import type { GetServerSidePropsContext } from 'next';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';
// P3-FIX: Import DomainId branded type and its unsafe cast factory.
// The UUID regex validation in getServerSideProps guarantees the string is a
// well-formed UUID, making the unsafeAsDomainId cast here safe by construction.
import type { DomainId } from '@kernel/branded';
import { unsafeAsDomainId } from '@kernel/branded';

interface DomainHealthProps {
  domainId: DomainId;
}

// P1-AUDIT-FIX: Replaced hardcoded mock data with explicit placeholder.
// Previous version displayed fabricated health metrics ("Broken links: 2", etc.)
// that users could mistake for real data and base business decisions on.
export default function DomainHealth({ domainId }: DomainHealthProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='health' />
      <h2>Domain Health</h2>
      <p style={{ color: '#666', fontStyle: 'italic' }}>
        Health metrics for this domain are not yet available. This feature is under development.
      </p>
    </AppShell>
  );
}

export async function getServerSideProps({ params }: GetServerSidePropsContext) {
  const id = params?.['id'];
  // P2-AUDIT-FIX: Validate domainId format (UUID) to reject malformed path params early
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { notFound: true };
  }
  // P3-FIX: Cast to DomainId after UUID validation — safe by construction.
  return { props: { domainId: unsafeAsDomainId(id) } };
}
