import type { GetServerSidePropsContext } from 'next';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';

interface KeywordsProps {
  domainId: string;
}

export default function Keywords({ domainId }: KeywordsProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='keywords' />
      <h2>Keywords</h2>

      <section>
        <h3>Active Keywords</h3>
        <p>Keywords explicitly accepted for this domain.</p>
        <button>Add keyword manually</button>
      </section>

      <section style={{ marginTop: 32 }}>
        <h3>Suggested Keywords (Advisory)</h3>
        <p>
          Suggestions are imported automatically from external sources.
          No keyword becomes active without explicit acceptance.
        </p>
        <button>Run ingestion</button>
        <ul>
          <li>example keyword suggestion</li>
        </ul>
        <button>Accept</button>
        <button>Reject</button>
      </section>
    </AppShell>
  );
}

export async function getServerSideProps({ params, req: _req }: GetServerSidePropsContext) {
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
