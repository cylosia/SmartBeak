import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';
import { withDomainAuth } from '../../../lib/auth';
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

export const getServerSideProps = withDomainAuth<LinksProps>(
  async (_context, domainId) => {
    // Placeholder aggregates; wire to read models
    return {
      props: {
        domainId,
        internal: { orphans: 3, hubs: 5, broken: 2 },
        external: { editorial: 42, affiliate: 18, broken: 4 }
      }
    };
  }
);
