
import { GetServerSideProps } from 'next';

import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';
import { requireServerAuth } from '../../../lib/server-auth';
import { authFetch, apiUrl } from '../../../lib/api-client';

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

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const auth = await requireServerAuth(ctx);
  if (!auth) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  const domainId = ctx.params?.['id'];
  if (typeof domainId !== 'string') {
    return { notFound: true };
  }

  try {
    const res = await authFetch(apiUrl(`diligence/links?domainId=${encodeURIComponent(domainId)}`), { ctx });
    if (!res.ok) {
      return { notFound: true };
    }
    const data = await res.json();
    return {
      props: {
        domainId,
        internal: {
          orphans: data.internal?.orphan_pages ?? 0,
          hubs: data.internal?.total_pages ?? 0,
          broken: data.internal?.broken_links ?? 0,
        },
        external: {
          editorial: (data.external?.total_external ?? 0) - (data.external?.affiliate_links ?? 0),
          affiliate: data.external?.affiliate_links ?? 0,
          broken: data.external?.broken_links ?? 0,
        },
      },
    };
  } catch {
    return { notFound: true };
  }
};
