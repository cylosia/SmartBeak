import { withDomainAuth } from '../../../lib/auth';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';

interface PersonasProps {
  domainId: string;
}

export default function Personas({ domainId }: PersonasProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='personas' />
      <h2>Customer Personas</h2>
      <p>Personas define the intended audience for content and email.</p>
      <ul>
        <li>Budget-conscious Buyer</li>
        <li>Power User / Enthusiast</li>
      </ul>
      <button>Create Persona</button>
    </AppShell>
  );
}

export const getServerSideProps = withDomainAuth();
