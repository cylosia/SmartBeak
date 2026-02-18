import type { GetServerSidePropsContext } from 'next';
import { requireDomainAccess } from '../../../../lib/auth';
import { AppShell } from '../../../../components/AppShell';
import { DomainTabs } from '../../../../components/DomainTabs';
import { EmailAudienceTabs } from '../../../../components/EmailAudienceTabs';

interface PerformanceProps {
  domainId: string;
}

export default function Performance({ domainId }: PerformanceProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='email' />
      <EmailAudienceTabs domainId={domainId} active='performance' />

      <h2>Email Performance & Deliverability</h2>
      <p>Advisory signals only. No automatic changes are made.</p>

      <ul>
        <li>Average open rate: 34%</li>
        <li>Average click rate: 6.1%</li>
        <li>Deliverability risk: Low</li>
      </ul>
    </AppShell>
  );
}

// P1-FIX: Validate UUID format and verify domain ownership before rendering.
// Without this check any authenticated user could view any domain's email
// deliverability metrics by guessing UUIDs in the URL (IDOR).
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
