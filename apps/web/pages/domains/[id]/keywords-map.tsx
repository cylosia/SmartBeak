import type { GetServerSidePropsContext } from 'next';
import { getAuth } from '@clerk/nextjs/server';
import { canAccessDomain } from '../../../lib/auth';
import { getPoolInstance } from '../../../lib/db';
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
  // P1-13 FIX: Domain authorization check to prevent IDOR
  const { userId } = getAuth(req);
  if (!userId) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  const pool = await getPoolInstance();
  const hasAccess = await canAccessDomain(userId, id, pool);
  if (!hasAccess) {
    return { notFound: true };
  }
  return { props: { domainId: id } };
}
