import type { GetServerSidePropsContext } from 'next';
import { AppShell } from '../../../../components/AppShell';
import { DomainTabs } from '../../../../components/DomainTabs';
import { EmailAudienceTabs } from '../../../../components/EmailAudienceTabs';

interface PerformanceProps {
  domainId: string;
}

export default function Performance({ domainId }: PerformanceProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='email' />
      <EmailAudienceTabs domainId={domainId} active='performance' />

      <h2>Email Performance & Deliverability</h2>
      <p>Advisory signals only. No automatic changes are made.</p>

      <ul>
        <li>Average open rate: 34%</li>
        <li>Average click rate: 6.1%</li>
        <li>Deliverability risk: Low</li>
      </ul>
    </AppShell>
  );
}

export async function getServerSideProps({ params }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }
  return { props: { domainId: id } };
}
