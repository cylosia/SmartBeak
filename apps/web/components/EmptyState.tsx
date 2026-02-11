export function EmptyState({ title, action }: { title: string; action?: any }) {
  return (
  <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>
    <p>{title}</p>
    {action}
  </div>
  );
}
