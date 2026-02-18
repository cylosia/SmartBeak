import { GetServerSideProps } from 'next';
import { requireDomainAccess } from '../../../../lib/auth';
import { AppShell } from '../../../../components/AppShell';
import { DomainTabs } from '../../../../components/DomainTabs';
import { EmailAudienceTabs } from '../../../../components/EmailAudienceTabs';

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getServerSideProps: GetServerSideProps = async ({ params, req }) => {
  const id = params?.['id'];
  if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
    return { notFound: true };
  }

  const authCheck = await requireDomainAccess(req, id);
  if (!authCheck.authorized) {
    return authCheck.result;
  }

  return { props: { domainId: id } };
};
