import Head from 'next/head';
import type { GetServerSidePropsContext } from 'next';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';
// P3-FIX: Import DomainId branded type and its unsafe cast factory.
// The UUID regex validation in getServerSideProps guarantees the string is a
// well-formed UUID, making the unsafeAsDomainId cast here safe by construction.
import type { DomainId } from '@kernel/branded';
import { unsafeAsDomainId } from '@kernel/branded';
// P0-FIX: Import requireDomainAccess — this page was completely unauthenticated.
// The Next.js middleware only protects /dashboard/*, /settings/*, /admin/*.
// /domains/[id]/* routes require an explicit auth check in getServerSideProps,
// matching the pattern used by integrations.tsx, personas.tsx, etc.
import { requireDomainAccess } from '../../../lib/auth';

interface DomainHistoryProps {
  domainId: DomainId;
}

// P1-AUDIT-FIX: Replaced hardcoded mock data with explicit placeholder.
// Previous version displayed fabricated history events that users could mistake for real data.
export default function DomainHistory({ domainId }: DomainHistoryProps) {
  return (
    <>
      <Head>
        <title>Domain History — ACP</title>
        <meta name="description" content="History of changes for this domain" />
      </Head>
      <AppShell>
        <DomainTabs domainId={domainId} active='history' />
        <h2>Domain History</h2>
        <p style={{ color: '#666', fontStyle: 'italic' }}>
          History for this domain is not yet available. This feature is under development.
        </p>
      </AppShell>
    </>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  const id = params?.['id'];
  // P2-AUDIT-FIX: Validate domainId format (UUID)
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    return { notFound: true };
  }

  // P0-FIX: Enforce authentication and domain-level authorization.
  // Without this check any unauthenticated user knowing (or guessing) a UUID
  // can load this page and confirm the UUID is valid — information disclosure
  // in an acquisition context where domain UUIDs are sensitive identifiers.
  const authCheck = await requireDomainAccess(req, id);
  if (!authCheck.authorized) {
    return authCheck.result;
  }

  // P3-FIX: Cast to DomainId after UUID validation — safe by construction.
  return { props: { domainId: unsafeAsDomainId(id) } };
}
