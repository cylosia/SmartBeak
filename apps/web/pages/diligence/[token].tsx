
import { GetServerSideProps } from 'next';

import { authFetch, apiUrl } from '../../lib/api-client';
export default function DiligenceOverview({ snapshot }: Record<string, unknown>) {
  if (!snapshot) return <div>Invalid or expired diligence session</div>;

  return (
  <main>
    <h1>Buyer Diligence Overview</h1>
    <pre>{JSON.stringify(snapshot, null, 2)}</pre>
  </main>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const token = ctx.params?.['token'];
  const res = await authFetch(apiUrl(`diligence/${token}/overview`), { ctx });

  if (!res.ok) {
  return { props: { snapshot: null } };
  }

  const snapshot = await res.json();
  return { props: { snapshot } };
};
