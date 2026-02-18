
import { GetServerSideProps } from 'next';
import { requireDomainAccess } from '../../../lib/auth';
import { AppShell } from '../../../components/AppShell';

interface DomainLifecycleProps {
  domainId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function DomainLifecycle({ domainId }: DomainLifecycleProps) {
  return (
  <AppShell>
    <h1>Domain Lifecycle</h1>
    <p>
      Managing domain: <strong>{domainId}</strong>
    </p>
    <p>Archive or transfer this domain. These actions are irreversible.</p>
    <button>Archive Domain</button>
    <button>Transfer Domain</button>
  </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps = async ({ params, req }) => {
  const domainId = params?.['id'];

  if (!domainId || typeof domainId !== 'string' || !UUID_RE.test(domainId)) {
    return { notFound: true };
  }

  const authCheck = await requireDomainAccess(req, domainId);
  if (!authCheck.authorized) {
    return authCheck.result;
  }

  return { props: { domainId } };
};
