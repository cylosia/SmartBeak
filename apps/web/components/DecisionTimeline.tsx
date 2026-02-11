export function DecisionTimeline({ events }: { events: any[] }) {
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
