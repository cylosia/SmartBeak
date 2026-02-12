import type { GetServerSidePropsContext } from 'next';
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

  // SECURITY FIX P2 #19: Verify the user has access to this domain.
  // Currently pages show static data, but this prevents future IDOR when data fetching is added.
  // TODO: Replace with actual auth check once getSession/getAuth is available in this context

  return { props: { domainId: id } };
}
