import type { GetServerSidePropsContext } from 'next';
import { requireDomainAccess } from '../../../lib/auth';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';

interface PersonasProps {
  domainId: string;
}

export default function Personas({ domainId }: PersonasProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='personas' />
      <h2>Customer Personas</h2>
      <p>Personas define the intended audience for content and email.</p>
      <ul>
        <li>Budget-conscious Buyer</li>
        <li>Power User / Enthusiast</li>
      </ul>
      <button>Create Persona</button>
    </AppShell>
  );
}

// P1-FIX: Validate UUID format and verify domain ownership before rendering.
// Without this check any authenticated user could enumerate any domain's
// persona configuration by guessing UUIDs in the URL (IDOR).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    return { notFound: true };
  }
  const authCheck = await requireDomainAccess(req, id);
  if (!authCheck.authorized) {
    return authCheck.result;
  }
  return { props: { domainId: id } };
}
