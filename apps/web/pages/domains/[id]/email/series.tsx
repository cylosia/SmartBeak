import type { GetServerSidePropsContext } from 'next';
import { requireDomainAccess } from '../../../../lib/auth';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const id = context.params?.['id'];
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    return { notFound: true };
  }
  const authCheck = await requireDomainAccess(context.req, id);
  if (!authCheck.authorized) {
    return authCheck.result;
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
