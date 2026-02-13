import type { GetServerSidePropsContext } from 'next';
import { getAuth } from '@clerk/nextjs/server';
import { canAccessDomain } from '../../../../lib/auth';
import { getPoolInstance } from '../../../../lib/db';
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

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const id = context.params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }
  // P1-13 FIX: Domain authorization check to prevent IDOR
  const { userId } = getAuth(context.req);
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
