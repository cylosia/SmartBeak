
import { GetServerSideProps } from 'next';
import { requireDomainAccess } from '../../../lib/auth';
import { getAuth } from '@clerk/nextjs/server';
import { canAccessDomain } from '../../../lib/auth';
import { getPoolInstance } from '../../../lib/db';

import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';
interface DomainIntegration {
  provider: string;
  status: string;
  account_identifier?: string;
}

interface DomainIntegrationsProps {
  domainId: string;
  integrations: DomainIntegration[];
}

export default function DomainIntegrations({ domainId, integrations }: DomainIntegrationsProps) {
  return (
  <AppShell>
    <DomainTabs domainId={domainId} active='integrations' />
    <h2>Domain Integrations</h2>
    <p>
    These integrations are scoped to this domain and transfer with it.
    Organization-level credentials are managed in Settings.
    </p>

    <table>
    <thead>
      <tr>
      <th>Provider</th>
      <th>Scope</th>
      <th>Status</th>
      <th>Account</th>
      <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {integrations.map((i: DomainIntegration) => (
      <tr key={i.provider}>
        <td>{i.provider}</td>
        <td>Domain</td>
        <td>{i.status}</td>
        <td>{i.account_identifier || '—'}</td>
        <td>
        <button>Connect / Replace</button>{' '}
        <button>Disconnect</button>
        </td>
      </tr>
      ))}
    </tbody>
    </table>

    <section style={{ marginTop: 24 }}>
    <h3>Common Domain Integrations</h3>
    <ul>
      <li>Google Search Console</li>
      <li>Amazon Associates</li>
      <li>Impact</li>
      <li>Email Sender (per brand)</li>
      <li>YouTube / Social accounts</li>
    </ul>
    </section>
  </AppShell>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getServerSideProps: GetServerSideProps = async ({ params, req }) => {
  const domainId = params?.['id'];

  if (!domainId || typeof domainId !== 'string' || !UUID_RE.test(domainId)) {
    return { notFound: true };
  }

  const authCheck = await requireDomainAccess(req, domainId);
  if (!authCheck.authorized) {
    return authCheck.result;
  }

  // TODO: Wire to domain_integrations table once migration is complete
  // P1-13 FIX: Domain authorization check to prevent IDOR
  const { userId } = getAuth(req);
  if (!userId) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  const pool = await getPoolInstance();
  const hasAccess = await canAccessDomain(userId, domainId, pool);
  if (!hasAccess) {
    return { notFound: true };
  }

  // TODO: Wire to domain_integrations table
  const integrations = [
  { provider: 'Google Search Console', status: 'connected', account_identifier: 'sc-domain:example.com' }
  ];
  return { props: { domainId, integrations } };
};
