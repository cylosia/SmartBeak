import type { GetServerSidePropsContext } from 'next';
import { getAuth } from '@clerk/nextjs/server';
import { canAccessDomain } from '../../../../lib/auth';
import { getPoolInstance } from '../../../../lib/db';
import { AppShell } from '../../../../components/AppShell';
import { DomainTabs } from '../../../../components/DomainTabs';
import { EmailAudienceTabs } from '../../../../components/EmailAudienceTabs';

interface SeriesProps {
  domainId: string;
}

export default function Series({ domainId }: SeriesProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='email' />
      <EmailAudienceTabs domainId={domainId} active='series' />

      <h2>Autoresponder Series</h2>
      <p>Email sequences triggered by lead magnets or subscriber events.</p>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Emails</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Welcome Series</td>
            <td>5</td>
            <td>Active</td>
          </tr>
        </tbody>
      </table>

      <br />
      <button>Create Series</button>
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
