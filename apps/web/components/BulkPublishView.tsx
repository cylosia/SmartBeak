
import React, { useState } from 'react';

interface Draft {
  id: string;
  title: string;
}

interface BulkPublishViewProps {
  drafts: Draft[];
  onPublish: (selectedIds: string[]) => void;
}

export function BulkPublishView({ drafts, onPublish }: BulkPublishViewProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
  setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) {
    next.delete(id);
    } else {
    next.add(id);
    }
    return next;
  });
  }

  return (
  <div>
    <h2>Bulk Publish</h2>
    {drafts.map((d) => (
    <label key={d.id}>
      <input
      type='checkbox'
      checked={selected.has(d.id)}
      onChange={() => toggle(d.id)}
      />
      {d.title}
    </label>
    ))}

    <button
    disabled={selected.size === 0}
    onClick={() => onPublish([...selected])}
    >
    Publish {selected.size} drafts
    </button>
  </div>
  );
}
