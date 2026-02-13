import { withDomainAuth } from '../../../lib/auth';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';

interface DomainHealthProps {
  domainId: string;
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

export const getServerSideProps = withDomainAuth();
