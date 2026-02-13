import type { GetServerSidePropsContext } from 'next';
import { requireDomainAccess } from '../../../lib/auth';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    return { notFound: true };
  }
  const authCheck = await requireDomainAccess(req, id);
  if (!authCheck.authorized) {
    return authCheck.result;
  }
  return { props: { domainId: id } };
}
