
import { GetServerSideProps } from 'next';
import { getAuth } from '@clerk/nextjs/server';

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
  // P1-FIX (P1-4): Require authentication before fetching buyer attribution data.
  // Without this gate, authFetch may return data to unauthenticated visitors if the
  // downstream endpoint is misconfigured, leaking domain acquisition intelligence.
  const { userId } = getAuth(ctx.req);
  if (!userId) {
    return { redirect: { destination: '/login', permanent: false } };
  }

  try {
    const res = await authFetch(apiUrl('attribution/buyer-safe'), { ctx });
    const rows = await res.json();
    return { props: { rows } };
  } catch {
    return { props: { rows: [], error: 'Failed to fetch attribution data' } };
  }
};
