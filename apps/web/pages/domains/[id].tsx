
import { GetServerSideProps } from 'next';

import { AppShell } from '../../components/AppShell';
import { authFetch, apiUrl } from '../../lib/api-client';

interface DomainDetailProps {
  domain: Record<string, unknown>;
  themes: Record<string, unknown>[];
}

export default function DomainDetail({ domain, themes }: DomainDetailProps) {
  return (
  <AppShell>
    <h1>{String(domain['name'] ?? '')}</h1>
    <p>Status: {String(domain['status'] ?? '')}</p>

    <section>
    <h2>Overview</h2>
    <pre>{JSON.stringify(domain, null, 2)}</pre>
    </section>

    <section>
    <h2>Theme</h2>
    <form>
      <select>
      {themes.map((t) => (
        <option key={String(t['id'])} value={String(t['id'])}>{String(t['name'] ?? '')}</option>
      ))}
      </select>
      <button type='submit'>Bind theme</button>
    </form>
    </section>

    <section>
    <h2>Deployment</h2>
    <p>
      Domains are deployed as one Vercel project per domain.
    </p>
    <button>Provision Vercel project</button>
    </section>

    <section>
    <h2>Buyer & Exit</h2>
    {/* H1-FIX: Removed broken buyerToken link — field not returned by GET /domains/:id */}
    <ul>
      <li><a href='/sell-ready'>Sell readiness</a></li>
    </ul>
    </section>
  </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const id = ctx.params?.['id'];

  const [domainRes, themesRes] = await Promise.all([
  authFetch(apiUrl(`domains/${id}`), { ctx }),
  authFetch(apiUrl('themes'), { ctx }),
  ]);

  const [domain, themes] = await Promise.all([
  domainRes.json(),
  themesRes.json(),
  ]);

  return { props: { domain, themes } };
};
