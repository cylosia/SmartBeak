import React from 'react';

// P2-TYPE FIX: Replace any with React.ReactNode for action prop
export function EmptyState({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
  <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>
    <p>{title}</p>
    {action}
  </div>
  );
}
