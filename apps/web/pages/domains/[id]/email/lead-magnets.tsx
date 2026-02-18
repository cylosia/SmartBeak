import type { GetServerSideProps } from 'next';
import { AppShell } from '../../../../components/AppShell';
import { DomainTabs } from '../../../../components/DomainTabs';
import { EmailAudienceTabs } from '../../../../components/EmailAudienceTabs';
import { requireServerAuth } from '../../../../lib/server-auth';

interface LeadMagnetsProps {
  domainId: string;
}

export default function LeadMagnets({ domainId }: LeadMagnetsProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='email' />
      <EmailAudienceTabs domainId={domainId} active='lead-magnets' />

      <h2>Lead Magnets</h2>
      <p>Lead magnets are domain-scoped assets used to acquire subscribers.</p>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Persona</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Email Marketing Checklist</td>
            <td>Founder</td>
            <td>Live</td>
          </tr>
        </tbody>
      </table>

      <br />
      <button>Create Lead Magnet</button>
    </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const auth = await requireServerAuth(ctx);
  if (!auth) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  const id = ctx.params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }
  return { props: { domainId: id } };
};
