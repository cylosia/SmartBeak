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

export async function getServerSideProps({ params }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }
  return { props: { domainId: id } };
}
