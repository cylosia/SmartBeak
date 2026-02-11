
import { GetServerSideProps } from 'next';

import { authFetch, apiUrl } from '../../lib/api-client';
export default function Timeline({ events }: any) {
  return (
  <main>
    <h1>Decision Timeline</h1>
    {events.map((e: any) => (
    <section key={e.intentId}>
      <h3>{e.intentType}</h3>
      <p>{e.justification}</p>
      <small>Requested at: {e.requestedAt}</small>
      <pre>{JSON.stringify(e, null, 2)}</pre>
    </section>
    ))}
  </main>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const domainId = ctx.params?.['domainId'];
  const res = await authFetch(apiUrl(`timeline/domain/${domainId}`), { ctx });

  const events = await res.json();
  return { props: { events } };
};
