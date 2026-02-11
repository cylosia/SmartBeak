
import React, { useState } from 'react';
export function EmailExperimentBuilder({ variants, onCreate }: any) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(id: string) {
  setSelected(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
  }

  return (
  <div>
    <h2>Email Experiment</h2>
    {variants.map((v: any) => (
    <label key={v["id"]}>
      <input type='checkbox' onChange={() => toggle(v["id"])} />
      {v.name}
    </label>
    ))}

    <button
    disabled={selected.length < 2}
    onClick={() => onCreate(selected)}
    >
    Create Experiment
    </button>
  </div>
  );
}
