
import { GetServerSideProps } from 'next';
import { requireDomainAccess } from '../../../lib/auth';

import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';
// P1-FIX: Replace `any` with proper types
interface LinkStats {
  orphans: number;
  hubs: number;
  broken: number;
}
interface ExternalLinkStats {
  editorial: number;
  affiliate: number;
  broken: number;
}
interface LinksProps {
  domainId: string;
  internal: LinkStats;
  external: ExternalLinkStats;
}
export default function Links({ domainId, internal, external }: LinksProps) {
  return (
  <AppShell>
    <DomainTabs domainId={domainId} active='links' />
    <h2>Links</h2>
    <p>
    Structural view of internal and external linking. Advisory only — no automatic changes.
    </p>

    <section>
    <h3>Internal Linking</h3>
    <ul>
      <li>Orphan pages: {internal.orphans}</li>
      <li>Hubs (high outbound): {internal.hubs}</li>
      <li>Broken internal links: {internal.broken}</li>
    </ul>
    </section>

    <section style={{ marginTop: 24 }}>
    <h3>External Linking</h3>
    <ul>
      <li>Editorial links: {external.editorial}</li>
      <li>Affiliate links: {external.affiliate}</li>
      <li>Broken external links: {external.broken}</li>
    </ul>
    </section>

    <section style={{ marginTop: 24 }}>
    <h3>Notes</h3>
    <p>
      To change links, edit the content directly and submit for review.
      ACP does not auto-insert or auto-remove links.
    </p>
    </section>
  </AppShell>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getServerSideProps: GetServerSideProps = async ({ params, req }) => {
  const rawId = params?.['id'];
  const domainId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!domainId || typeof domainId !== 'string' || !UUID_RE.test(domainId)) {
    return { notFound: true };
  }

  const authCheck = await requireDomainAccess(req, domainId);
  if (!authCheck.authorized) {
    return authCheck.result;
  }

  // Placeholder aggregates; wire to read models
  return {
  props: {
    domainId,
    internal: { orphans: 0, hubs: 0, broken: 0 },
    external: { editorial: 0, affiliate: 0, broken: 0 }
  }
  };
};
