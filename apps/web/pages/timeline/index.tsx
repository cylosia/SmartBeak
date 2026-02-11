
import { GetServerSideProps } from 'next';

import { DecisionTimeline } from '../../components/DecisionTimeline';
import { authFetch, apiUrl } from '../../lib/api-client';
export default function Timeline({ events }: any) {
  return (
  <main>
    <h1>Decision Timeline</h1>
    <DecisionTimeline events={events} />
  </main>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const res = await authFetch(apiUrl('timeline'), { ctx });
  const events = await res.json();

  return { props: { events } };
};
