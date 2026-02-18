import type { GetServerSidePropsContext } from 'next';
import { requireDomainAccess } from '../../../lib/auth';
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

// P1-FIX: Validate UUID format and verify domain ownership (requireDomainAccess)
// before rendering. Without this check any authenticated user could view any
// domain's pending queue by guessing UUIDs in the URL (IDOR).
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
