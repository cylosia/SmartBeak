
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
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(id: string) {
  setSelected(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
  }

  return (
  <div>
    <h2>Bulk Publish</h2>
    {drafts.map((d) => (
    <label key={d.id}>
      <input
      type='checkbox'
      checked={selected.includes(d.id)}
      onChange={() => toggle(d.id)}
      />
      {d.title}
    </label>
    ))}

    <button
    disabled={selected.length === 0}
    onClick={() => onPublish(selected)}
    >
    Publish {selected.length} drafts
    </button>
  </div>
  );
}
