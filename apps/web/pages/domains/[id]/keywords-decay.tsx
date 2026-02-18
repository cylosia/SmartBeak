import type { GetServerSidePropsContext } from 'next';
import { requireDomainAccess } from '../../../lib/auth';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';
// FIX BUG-12: Import UUID_RE from the shared utility instead of duplicating it.
import { UUID_RE } from '../../../lib/uuid';
import { getLogger } from '@kernel/logger';

const logger = getLogger('keywords-decay-page');

interface KeywordDecayProps {
  domainId: string;
}

export default function KeywordDecay({ domainId }: KeywordDecayProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='keywords' />
      <h2>Keyword Decay</h2>
      <p>
        Observational signals indicating declining keyword performance.
      </p>
      {/* FIX P2-11: Removed hardcoded placeholder. Connect to real decay data from API. */}
      <p><em>No decay signals detected yet for this domain.</em></p>
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
    logger.error('[keywords-decay] getServerSideProps error', error instanceof Error ? error : new Error(String(error)));
    return { notFound: true };
  }
}
