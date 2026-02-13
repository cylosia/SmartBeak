import type { GetServerSidePropsContext } from 'next';
import { getAuth } from '@clerk/nextjs/server';
import { canAccessDomain } from '../../../lib/auth';
import { getPoolInstance } from '../../../lib/db';
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

export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }
  // P1-13 FIX: Domain authorization check to prevent IDOR
  const { userId } = getAuth(req);
  if (!userId) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  const pool = await getPoolInstance();
  const hasAccess = await canAccessDomain(userId, id, pool);
  if (!hasAccess) {
    return { notFound: true };
  }
  return { props: { domainId: id } };
}
