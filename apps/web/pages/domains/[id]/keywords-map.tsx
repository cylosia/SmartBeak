import type { GetServerSidePropsContext } from 'next';
import { requireDomainAccess } from '../../../lib/auth';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';
// FIX BUG-12: Import UUID_RE from the shared utility instead of duplicating it.
import { UUID_RE } from '../../../lib/uuid';
import { getLogger } from '@kernel/logger';

const logger = getLogger('keywords-map-page');

interface KeywordContentMapProps {
  domainId: string;
}

export default function KeywordContentMap({ domainId }: KeywordContentMapProps) {
  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='keywords' />
      <h2>Map Keywords to Content</h2>
      <p>
        Explicitly map accepted keywords to content. This is advisory and
        does not change rankings automatically.
      </p>
      {/*
        FIX P2-10: Form had no action, no onSubmit, no name attributes, and no CSRF
        token — clicking "Map" silently did nothing. The form is disabled pending a
        full implementation with API integration and CSRF middleware.
        FIX P2-12: Added id/htmlFor association and aria-label for accessibility.
        TODO: Wire up to POST /api/keywords/map with CSRF token and domainId in body.
      */}
      <form
        aria-label='Map keyword to content'
        onSubmit={(e) => { e.preventDefault(); }}
      >
        <label htmlFor='kw-keyword'>
          Keyword
          <br />
          <input
            id='kw-keyword'
            type='text'
            name='keyword'
            placeholder='accepted keyword'
            required
          />
        </label>
        <br /><br />
        <label htmlFor='kw-content'>
          Content
          <br />
          <input
            id='kw-content'
            type='text'
            name='content'
            placeholder='content title or ID'
            required
          />
        </label>
        <br /><br />
        <label htmlFor='kw-role'>
          Role
          <br />
          <select id='kw-role' name='role' aria-label='Keyword role' required>
            <option value='primary'>primary</option>
            <option value='secondary'>secondary</option>
            <option value='supporting'>supporting</option>
          </select>
        </label>
        <br /><br />
        {/* Button is disabled until API endpoint is implemented */}
        <button type='submit' disabled title='API integration pending'>Map</button>
      </form>
    </AppShell>
  );
}

export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  // FIX P2-13: Wrap in try/catch so auth errors return 404 rather than 500.
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
    logger.error('[keywords-map] getServerSideProps error', error instanceof Error ? error : new Error(String(error)));
    return { notFound: true };
  }
}
