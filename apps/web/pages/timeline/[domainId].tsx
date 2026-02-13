
import { GetServerSideProps } from 'next';

import { authFetch, apiUrl } from '../../lib/api-client';

interface TimelineEvent {
  intentId: string;
  intentType: string;
  justification: string;
  requestedAt: string;
  [key: string]: unknown;
}

interface TimelineProps {
  events: TimelineEvent[];
}

export default function Timeline({ events }: TimelineProps) {
  return (
  <main>
    <h1>Decision Timeline</h1>
    {events.map((e) => (
    <section key={e['intentId']}>
      <h3>{e['intentType']}</h3>
      <p>{e['justification']}</p>
      <small>Requested at: {e['requestedAt']}</small>
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
