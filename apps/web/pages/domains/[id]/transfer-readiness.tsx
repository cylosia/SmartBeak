import { withDomainAuth } from '../../../lib/auth';
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
      <ul>
        <li>Domain integrations scoped ✓</li>
        <li>No org-level dependencies ✓</li>
        <li>Revenue ledger complete ✓</li>
        <li>Content ownership clear ✓</li>
      </ul>
    </AppShell>
  );
}

export const getServerSideProps = withDomainAuth();
