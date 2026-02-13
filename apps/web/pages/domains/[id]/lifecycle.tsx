import { AppShell } from '../../../components/AppShell';
import { withDomainAuth, type DomainPageProps } from '../../../lib/auth';

export default function DomainLifecycle({ domainId: _domainId }: DomainPageProps) {
  return (
  <AppShell>
    <h1>Domain Lifecycle</h1>
    <p>Archive or transfer this domain. These actions are irreversible.</p>
    <button>Archive Domain</button>
    <button>Transfer Domain</button>
  </AppShell>
  );
}

export const getServerSideProps = withDomainAuth();
