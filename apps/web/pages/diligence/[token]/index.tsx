
import { GetServerSideProps } from 'next';

import { authFetch, apiUrl } from '../../../lib/api-client';
export default function BuyerDiligence({ overview, revenue }: Record<string, unknown>) {
  return (
  <main>
    <h1>Buyer Diligence</h1>

    <section>
    <h2>Overview</h2>
    <pre>{JSON.stringify(overview, null, 2)}</pre>
    </section>

    <section>
    <h2>Revenue & Confidence</h2>
    <pre>{JSON.stringify(revenue, null, 2)}</pre>
    </section>

    <p>
    <small>
      Revenue is reported by affiliate networks and may be delayed or revised.
    </small>
    </p>
  </main>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const token = ctx.params?.['token'];

  const [overviewRes, revenueRes] = await Promise.all([
  authFetch(apiUrl(`diligence/${token}/overview`), { ctx }),
  authFetch(apiUrl(`diligence/${token}/affiliate-revenue`), { ctx }),
  ]);

  const [overview, revenue] = await Promise.all([
  overviewRes.json(),
  revenueRes.json(),
  ]);

  return { props: { overview, revenue } };
};
