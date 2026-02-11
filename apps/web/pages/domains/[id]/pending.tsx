import type { GetServerSidePropsContext } from 'next';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';

interface DomainPendingProps {
  domainId: string;
}

export default function DomainPending({ domainId }: DomainPendingProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='overview' />
      <h2>Pending Items</h2>
      <ul>
        <li>Draft content awaiting review</li>
        <li>Email series draft</li>
        <li>Keyword suggestions pending acceptance</li>
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
