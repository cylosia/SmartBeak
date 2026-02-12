
import { GetServerSideProps } from 'next';

import { AppShell } from '../../components/AppShell';
import { authFetch, apiUrl } from '../../lib/api-client';
// M1-FIX: Wrapped in AppShell for consistent navigation
export default function Portfolio({ revenue, risk }: any) {
  return (
  <AppShell>
    <h1>Portfolio Overview</h1>

    <section>
    <h2>Revenue Confidence</h2>
    <pre>{JSON.stringify(revenue, null, 2)}</pre>
    </section>

    <section>
    <h2>Risk & Dependency</h2>
    <pre>{JSON.stringify(risk, null, 2)}</pre>
    </section>
  </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const [revenueRes, riskRes] = await Promise.all([
  authFetch(apiUrl('portfolio/revenue-confidence'), { ctx }),
  authFetch(apiUrl('portfolio/dependency-risk'), { ctx }),
  ]);

  const [revenue, risk] = await Promise.all([
  revenueRes.json(),
  riskRes.json(),
  ]);

  return { props: { revenue, risk } };
};
