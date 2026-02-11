export function IntentDrawer({ intents }: { intents: any[] }) {
  return (
  <aside style={{ borderLeft: '1px solid #ddd', padding: 16 }}>
    <h3>Pending Decisions</h3>
    {intents.length === 0 && <p>No pending intents</p>}
    <ul>
    {intents.map(i => (
      <li key={i["id"]}>
      <strong>{i.intentType}</strong>
      <div>Status: {i.status}</div>
      </li>
    ))}
    </ul>
  </aside>
  );
}
