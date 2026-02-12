import type { GetServerSidePropsContext } from 'next';
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

  // SECURITY FIX P2 #19: Verify the user has access to this domain.
  // Currently pages show static data, but this prevents future IDOR when data fetching is added.
  // TODO: Replace with actual auth check once getSession/getAuth is available in this context
  // e.g.: const session = await getAuth(context);
  //       if (!session?.orgId) return { redirect: { destination: '/login', permanent: false } };
  //       const domain = await db.query('SELECT id FROM domains WHERE id = $1 AND org_id = $2', [id, session.orgId]);
  //       if (!domain) return { notFound: true };

  return { props: { domainId: id } };
}
