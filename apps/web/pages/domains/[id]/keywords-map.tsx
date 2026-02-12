import type { GetServerSidePropsContext } from 'next';
import { AppShell } from '../../../components/AppShell';
import { DomainTabs } from '../../../components/DomainTabs';

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
      <form>
        <label>Keyword<br /><input type='text' placeholder='accepted keyword' /></label><br /><br />
        <label>Content<br /><input type='text' placeholder='content title or ID' /></label><br /><br />
        <label>Role<br />
          <select>
            <option>primary</option>
            <option>secondary</option>
            <option>supporting</option>
          </select>
        </label><br /><br />
        <button type='submit'>Map</button>
      </form>
    </AppShell>
  );
}

export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }
  // P1-13: TODO — Add domain authorization check here.
  // The Clerk middleware authenticates the user, but does not verify
  // that the user has access to this specific domain (IDOR risk).
  // Use canAccessDomain(userId, id, db) from lib/auth.ts once
  // a server-side DB pool is available in getServerSideProps.
  return { props: { domainId: id } };
}
