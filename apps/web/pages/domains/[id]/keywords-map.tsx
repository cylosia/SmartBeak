import type { GetServerSidePropsContext } from 'next';
import { requireDomainAccess } from '../../../lib/auth';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    return { notFound: true };
  }
  const authCheck = await requireDomainAccess(req, id);
  if (!authCheck.authorized) {
    return authCheck.result;
  }
  return { props: { domainId: id } };
}
