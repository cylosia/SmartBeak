
import React, { useState } from 'react';

// P2-TYPE FIX: Replace any props with proper interface
interface ExperimentVariant {
  id: string;
  name: string;
}

interface EmailExperimentBuilderProps {
  variants: ExperimentVariant[];
  onCreate: (selectedIds: string[]) => void;
}

export function EmailExperimentBuilder({ variants, onCreate }: EmailExperimentBuilderProps) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(id: string) {
  setSelected(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
  }

  return (
  <div>
    <h2>Email Experiment</h2>
    {variants.map((v) => (
    <label key={v.id}>
      <input type='checkbox' onChange={() => toggle(v.id)} />
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
