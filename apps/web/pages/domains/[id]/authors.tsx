import type { GetServerSidePropsContext } from 'next';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';

interface AuthorsProps {
  domainId: string;
}

export default function Authors({ domainId }: AuthorsProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='authors' />
      <h2>Authors</h2>
      <p>Authors represent voices for this domain. They are not users.</p>
      <table>
        <thead><tr><th>Name</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>Jane Smith</td><td>Reviewer</td><td>Active</td></tr>
        </tbody>
      </table>
      <br />
      <button>Create Author</button>
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
