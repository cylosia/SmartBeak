
import { GetServerSideProps } from 'next';

import { AppShell } from '../../components/AppShell';
import { DecisionTimeline } from '../../components/DecisionTimeline';
import { authFetch, apiUrl } from '../../lib/api-client';

interface TimelineEvent {
  intentId: string;
  intentType: string;
  justification: string;
  requestedAt: string;
}

interface TimelineIndexProps {
  events: TimelineEvent[];
}

// M1-FIX: Wrapped in AppShell for consistent navigation
export default function Timeline({ events }: TimelineIndexProps) {
  return (
  <AppShell>
    <h1>Decision Timeline</h1>
    <DecisionTimeline events={events} />
  </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const res = await authFetch(apiUrl('timeline'), { ctx });
  // H4-FIX: Destructure events array from response (was passing full object with total/filters)
  const { events } = await res.json();

  return { props: { events: events || [] } };
};
