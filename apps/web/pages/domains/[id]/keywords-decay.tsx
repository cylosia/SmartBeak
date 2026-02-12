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

export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }
  // P1-13: TODO — Add domain authorization check here.
  // The Clerk middleware authenticates the user, but does not verify
  // that the user has access to this specific domain (IDOR risk).
  // Use canAccessDomain(userId, id, db) from lib/auth.ts once
  // a server-side DB pool is available in getServerSideProps.
  return { props: { domainId: id } };
}
