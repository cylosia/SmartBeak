import type { GetServerSidePropsContext } from 'next';
import { requireDomainAccess } from '../../../lib/auth';
import { getAuth } from '@clerk/nextjs/server';
import { canAccessDomain } from '../../../lib/auth';
import { getPoolInstance } from '../../../lib/db';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    return { notFound: true };
  }
  const authCheck = await requireDomainAccess(req, id);
  if (!authCheck.authorized) {
    return authCheck.result;
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
