interface TimelineEvent {
  intentId: string;
  intentType: string;
  justification: string;
  requestedAt: string;
}

export function DecisionTimeline({ events }: { events: TimelineEvent[] }) {
  return (
  <ol>
    {events.map(e => (
    <li key={e.intentId}>
      <strong>{e.intentType}</strong>
      <div>{e.justification}</div>
      <small>{e.requestedAt}</small>
    </li>
    ))}
  </ol>
  );
}
