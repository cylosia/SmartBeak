
import { GetServerSideProps } from 'next';

import { authFetch, apiUrl } from '../../lib/api-client';
export default function BuyerAttribution({ rows, error }: { rows: unknown; error?: string }) {
  return (
  <main>
    <h1>Content Creation Patterns (Aggregated)</h1>
    {error && <p>Failed to load data. Please try again later.</p>}
    <pre>{JSON.stringify(rows, null, 2)}</pre>
  </main>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  try {
    const res = await authFetch(apiUrl('attribution/buyer-safe'), { ctx });
    const rows = await res.json();
    return { props: { rows } };
  } catch {
    return { props: { rows: [], error: 'Failed to fetch attribution data' } };
  }
};
