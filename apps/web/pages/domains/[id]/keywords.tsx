import type { GetServerSidePropsContext } from 'next';
import { requireDomainAccess } from '../../../lib/auth';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';
// FIX BUG-12: Import UUID_RE from the shared utility instead of duplicating it.
import { UUID_RE } from '../../../lib/uuid';
import { getLogger } from '@kernel/logger';

const logger = getLogger('keywords-page');

interface KeywordsProps {
  domainId: string;
}

export default function Keywords({ domainId }: KeywordsProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='keywords' />
      <h2>Keywords</h2>

      <section>
        <h3>Active Keywords</h3>
        <p>Keywords explicitly accepted for this domain.</p>
        <button>Add keyword manually</button>
      </section>

      {/* FIX P2-11: Removed hardcoded placeholder <li>. Connect to real API data. */}
      <section className='mt-8'>
        <h3>Suggested Keywords (Advisory)</h3>
        <p>
          Suggestions are imported automatically from external sources.
          No keyword becomes active without explicit acceptance.
        </p>
        <button>Run ingestion</button>
        <p><em>No suggestions yet. Run ingestion to import keyword suggestions.</em></p>
        <button>Accept</button>
        <button>Reject</button>
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
    return { props: { domainId: id } };
  } catch (error) {
    logger.error('[keywords] getServerSideProps error', error instanceof Error ? error : new Error(String(error)));
    return { notFound: true };
  }
}
