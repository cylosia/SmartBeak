import type { GetServerSidePropsContext } from 'next';
import { requireDomainAccess } from '../../../../lib/auth';
import { AppShell } from '../../../../components/AppShell';
import { DomainTabs } from '../../../../components/DomainTabs';
import { EmailAudienceTabs } from '../../../../components/EmailAudienceTabs';

interface SubscribersProps {
  domainId: string;
}

export default function Subscribers({ domainId }: SubscribersProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='email' />
      <EmailAudienceTabs domainId={domainId} active='subscribers' />

      <h2>Subscribers</h2>
      <p>Subscribers are shown read-only to preserve consent integrity.</p>

      <ul>
        <li>Active: 1,204</li>
        <li>Pending double opt-in: 37</li>
        <li>Unsubscribed: 128</li>
      </ul>
    </AppShell>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const id = context.params?.['id'];
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    return { notFound: true };
  }
  const authCheck = await requireDomainAccess(context.req, id);
  if (!authCheck.authorized) {
    return authCheck.result;
  }
  return { props: { domainId: id } };
}
