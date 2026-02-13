import { withDomainAuth } from '../../../lib/auth';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';

interface KeywordDecayProps {
  domainId: string;
}

export default function KeywordDecay({ domainId }: KeywordDecayProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='keywords' />
      <h2>Keyword Decay</h2>
      <p>
        Observational signals indicating declining keyword performance.
      </p>
      <ul>
        <li>example keyword — decay detected</li>
      </ul>
    </AppShell>
  );
}

export const getServerSideProps = withDomainAuth();
