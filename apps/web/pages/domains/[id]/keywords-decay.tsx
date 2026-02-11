import type { GetServerSidePropsContext } from 'next';
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

export async function getServerSideProps({ params }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }
  return { props: { domainId: id } };
}
