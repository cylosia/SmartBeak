import { withDomainAuth } from '../../../lib/auth';
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

export const getServerSideProps = withDomainAuth();
