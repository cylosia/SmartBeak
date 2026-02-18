import type { GetServerSidePropsContext } from 'next';
import { requireDomainAccess } from '../../../lib/auth';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';
// FIX BUG-12: Import UUID_RE from the shared utility instead of duplicating it.
import { UUID_RE } from '../../../lib/uuid';
import { getLogger } from '@kernel/logger';
import type { DomainId } from '@kernel/branded';
import { createDomainId } from '@kernel/branded';

const logger = getLogger('keywords-page');

interface KeywordsProps {
  // FIX: Brand domainId so the type system enforces ownership-checked identity
  // throughout the component tree and any future API calls.
  domainId: DomainId;
}

export default function Keywords({ domainId }: KeywordsProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='keywords' />
      <h2>Keywords</h2>

      <section>
        <h3>Active Keywords</h3>
        <p>Keywords explicitly accepted for this domain.</p>
        {/* FIX: type="button" prevents accidental form submission if ever wrapped in a <form> */}
        <button type="button">Add keyword manually</button>
      </section>

      {/* FIX P2-11: Removed hardcoded placeholder <li>. Connect to real API data. */}
      <section className='mt-8'>
        <h3>Suggested Keywords (Advisory)</h3>
        <p>
          Suggestions are imported automatically from external sources.
          No keyword becomes active without explicit acceptance.
        </p>
        <button type="button">Run ingestion</button>
        <p><em>No suggestions yet. Run ingestion to import keyword suggestions.</em></p>
        <button type="button">Accept</button>
        <button type="button">Reject</button>
      </section>
    </AppShell>
  );
}

export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  // FIX P2-13: Wrap in try/catch so auth errors are logged and return 404
  // rather than propagating to Next.js default error handler.
  // FIX BUG-13: Log errors before returning notFound so auth infrastructure
  // failures are visible in structured logs rather than silently swallowed.
  try {
    const id = params?.['id'];
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return { notFound: true };
    }
    const authCheck = await requireDomainAccess(req, id);
    if (!authCheck.authorized) {
      return authCheck.result;
    }
    // createDomainId validates UUID format (redundant here since UUID_RE already checked,
    // but enforces the branded type contract for the component prop).
    return { props: { domainId: createDomainId(id) } };
  } catch (error) {
    // Security: return notFound for auth/authorization errors to prevent domain enumeration.
    // Infrastructure failures (DB down) are also masked here intentionally; monitor logs.
    logger.error('[keywords] getServerSideProps error', error instanceof Error ? error : new Error(String(error)));
    return { notFound: true };
  }
}
