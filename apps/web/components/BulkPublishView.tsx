
import React, { useState } from 'react';
export function BulkPublishView({ drafts, onPublish }: any) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(id: string) {
  setSelected(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
  }

  return (
  <div>
    <h2>Bulk Publish</h2>
    {drafts.map((d: any) => (
    <label key={d["id"]}>
      <input
      type='checkbox'
      onChange={() => toggle(d["id"])}
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
