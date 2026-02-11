import type { GetServerSidePropsContext } from 'next';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';

interface DomainHistoryProps {
  domainId: string;
}

export default function DomainHistory({ domainId }: DomainHistoryProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='overview' />
      <h2>Domain History</h2>
      <ul>
        <li>Domain created</li>
        <li>Theme bound</li>
        <li>Deployed to Vercel</li>
        <li>Archived</li>
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
