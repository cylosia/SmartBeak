
import { GetServerSideProps } from 'next';

import { authFetch, apiUrl } from '../../lib/api-client';
export default function BuyerAttribution({ rows }: Record<string, unknown>) {
  return (
  <main>
    <h1>Content Creation Patterns (Aggregated)</h1>
    <pre>{JSON.stringify(rows, null, 2)}</pre>
  </main>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const res = await authFetch(apiUrl('attribution/buyer-safe'), { ctx });
  const rows = await res.json();
  return { props: { rows } };
};
