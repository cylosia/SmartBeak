import type { GetServerSidePropsContext } from 'next';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';

interface DomainHealthProps {
  domainId: string;
}

export default function DomainHealth({ domainId }: DomainHealthProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='overview' />
      <h2>Domain Health</h2>
      <ul>
        <li>Content freshness: OK</li>
        <li>Broken links: 2</li>
        <li>Monetization decay flags: None</li>
        <li>Replaceability risk: Medium</li>
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
